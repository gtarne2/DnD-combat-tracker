use std::{
    collections::{BTreeMap, HashSet},
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
};

use roxmltree::{Document, Node};

mod content;

pub use content::{ContentDefinition, ContentElement, ContentNode};

use content::ContentIndex;

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedCharacter {
    pub name: Option<String>,
    pub equipment: Vec<ImportedItem>,
    pub spells: Vec<ImportedReference>,
    pub build_elements: Vec<ImportedReference>,
    pub companions: Vec<ImportedReference>,
    /// Definitions reachable from the save. A present key with no value marks missing content.
    pub definitions: BTreeMap<String, Option<ContentDefinition>>,
}

impl ImportedCharacter {
    /// Features recorded as selections in the save. Related options are in the definition catalog.
    pub fn features(&self) -> impl Iterator<Item = &ImportedReference> {
        self.build_elements.iter().filter(|reference| {
            reference.kind().is_some_and(|kind| {
                matches!(
                    kind,
                    "Feat" | "Feature" | "Racial Trait" | "Companion Trait"
                ) || kind.ends_with(" Feature")
            })
        })
    }
}

pub type ImportedItem = ImportedReference;

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedReference {
    pub content_id: String,
    pub saved_name: Option<String>,
    pub saved_kind: Option<String>,
    /// None when the supplied XML has no definition for this ID.
    pub definition: Option<ContentDefinition>,
}

impl ImportedReference {
    pub fn kind(&self) -> Option<&str> {
        self.definition
            .as_ref()
            .and_then(|definition| definition.kind.as_deref())
            .or(self.saved_kind.as_deref())
    }
}

#[derive(Debug)]
pub enum ImportError {
    Read {
        path: PathBuf,
        source: io::Error,
    },
    Xml {
        path: PathBuf,
        source: roxmltree::Error,
    },
    Structure {
        path: PathBuf,
        message: String,
    },
}

impl fmt::Display for ImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, source } => {
                write!(formatter, "could not read {}: {source}", path.display())
            }
            Self::Xml { path, source } => {
                write!(formatter, "invalid XML in {}: {source}", path.display())
            }
            Self::Structure { path, message } => write!(formatter, "{}: {message}", path.display()),
        }
    }
}

impl Error for ImportError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Read { source, .. } => Some(source),
            Self::Xml { source, .. } => Some(source),
            Self::Structure { .. } => None,
        }
    }
}

/// Reads a UTF-8 Aurora save and resolves its references against one content XML file.
pub fn import_character(
    save_path: &Path,
    content_path: &Path,
) -> Result<ImportedCharacter, ImportError> {
    import_character_with_content(save_path, &[content_path])
}

/// Resolves a UTF-8 Aurora save using content files in Aurora load order, with overrides last.
pub fn import_character_with_content(
    save_path: &Path,
    content_paths: &[&Path],
) -> Result<ImportedCharacter, ImportError> {
    let save_xml = read_xml(save_path)?;
    let save = parse_xml(&save_xml, save_path, "character")?;
    let build = child(save.root_element(), "build")
        .ok_or_else(|| structure_error(save_path, "expected a <build> section"))?;
    let name = child(build, "input")
        .and_then(|input| child(input, "name"))
        .and_then(|name| name.text())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned);

    let equipment = children_named(build, "equipment")
        .flat_map(|items| children_named(items, "item"))
        .map(|item| {
            SavedReference::from_node(item)
                .ok_or_else(|| structure_error(save_path, "equipment <item> has no content ID"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let build_elements: Vec<_> = children_named(build, "elements")
        .flat_map(|elements| elements.descendants())
        .filter(|node| node.has_tag_name("element"))
        .filter_map(SavedReference::from_node)
        .collect();

    let mut spells: Vec<_> = children_named(build, "magic")
        .flat_map(|magic| children_named(magic, "spellcasting"))
        .flat_map(|casting| casting.children())
        .filter(|list| list.has_tag_name("spells") || list.has_tag_name("cantrips"))
        .flat_map(|list| children_named(list, "spell"))
        .filter_map(SavedReference::from_node)
        .collect();
    let mut spell_ids: HashSet<_> = spells.iter().map(|spell| spell.id).collect();
    spells.extend(
        build_elements
            .iter()
            .copied()
            .filter(|element| element.kind == Some("Spell") && spell_ids.insert(element.id)),
    );

    let companions: Vec<_> = children_named(build, "companion")
        .filter_map(SavedReference::from_node)
        .chain(build_elements.iter().copied().filter(|element| {
            element.kind == Some("Companion")
                || element.node.parent_element().is_some_and(|parent| {
                    parent.has_tag_name("element") && parent.attribute("type") == Some("Companion")
                })
        }))
        .collect();

    let xml = content_paths
        .iter()
        .map(|path| read_xml(path))
        .collect::<Result<Vec<_>, _>>()?;
    let documents = content_paths
        .iter()
        .zip(&xml)
        .map(|(path, xml)| parse_xml(xml, path, "elements"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut index = ContentIndex::default();
    for (path, document) in content_paths.iter().zip(&documents) {
        index.add_file(path, document)?;
    }

    let roots = equipment
        .iter()
        .chain(&spells)
        .chain(&build_elements)
        .chain(&companions)
        .map(|reference| reference.id)
        .chain(
            build_elements
                .iter()
                .filter(|reference| reference.kind == Some("Level"))
                .filter_map(|reference| reference.node.attribute("class"))
                .filter(|id| !id.trim().is_empty()),
        )
        .map(str::to_owned)
        .collect();
    let definitions = index.resolve_graph(roots);
    let resolve = |references: Vec<SavedReference<'_, '_>>| {
        references
            .into_iter()
            .map(|reference| ImportedReference {
                content_id: reference.id.to_owned(),
                saved_name: reference.node.attribute("name").map(str::to_owned),
                saved_kind: reference.kind.map(str::to_owned),
                definition: definitions
                    .get(reference.id)
                    .and_then(Option::as_ref)
                    .cloned(),
            })
            .collect()
    };

    Ok(ImportedCharacter {
        name,
        equipment: resolve(equipment),
        spells: resolve(spells),
        build_elements: resolve(build_elements),
        companions: resolve(companions),
        definitions,
    })
}

#[derive(Clone, Copy)]
struct SavedReference<'a, 'input> {
    node: Node<'a, 'input>,
    id: &'a str,
    kind: Option<&'a str>,
}

impl<'a, 'input> SavedReference<'a, 'input> {
    fn from_node(node: Node<'a, 'input>) -> Option<Self> {
        Some(Self {
            node,
            id: content_id(node)?,
            kind: node.attribute("type"),
        })
    }
}

fn read_xml(path: &Path) -> Result<String, ImportError> {
    fs::read_to_string(path).map_err(|source| ImportError::Read {
        path: path.to_owned(),
        source,
    })
}

fn parse_xml<'a>(xml: &'a str, path: &Path, root: &str) -> Result<Document<'a>, ImportError> {
    let doc = Document::parse(xml).map_err(|source| ImportError::Xml {
        path: path.to_owned(),
        source,
    })?;
    if !doc.root_element().has_tag_name(root) {
        return Err(structure_error(
            path,
            format!("expected <{root}> as the root element"),
        ));
    }
    Ok(doc)
}

fn child<'a, 'input>(node: Node<'a, 'input>, tag: &str) -> Option<Node<'a, 'input>> {
    node.children().find(|child| child.has_tag_name(tag))
}

fn children_named<'a, 'input>(
    node: Node<'a, 'input>,
    tag: &'static str,
) -> impl Iterator<Item = Node<'a, 'input>> {
    node.children().filter(move |child| child.has_tag_name(tag))
}

fn content_id<'a>(node: Node<'a, '_>) -> Option<&'a str> {
    node.attribute("id").filter(|id| !id.trim().is_empty())
}

fn structure_error(path: &Path, message: impl Into<String>) -> ImportError {
    ImportError::Structure {
        path: path.to_owned(),
        message: message.into(),
    }
}
