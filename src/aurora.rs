use std::{
    collections::HashMap,
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
};

use roxmltree::{Document, Node};

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedCharacter {
    pub name: Option<String>,
    pub equipment: Vec<ImportedItem>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedItem {
    pub content_id: String,
    pub saved_name: Option<String>,
    /// None when the supplied XML has no definition for this ID.
    pub definition: Option<ContentDefinition>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ContentDefinition {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub source: Option<String>,
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

/// Reads a UTF-8 Aurora save and resolves its equipment against one content XML file.
pub fn import_character(
    save_path: &Path,
    content_path: &Path,
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

    let content_xml = read_xml(content_path)?;
    let content = parse_xml(&content_xml, content_path, "elements")?;
    let mut definitions = HashMap::new();
    for element in content
        .root_element()
        .children()
        .filter(|node| node.has_tag_name("element"))
    {
        let id = content_id(element)
            .ok_or_else(|| structure_error(content_path, "content <element> has no ID"))?;
        if definitions.insert(id, element).is_some() {
            return Err(structure_error(
                content_path,
                format!("duplicate content ID {id}"),
            ));
        }
    }

    let mut equipment = Vec::new();
    if let Some(items) = child(build, "equipment") {
        for item in items.children().filter(|node| node.has_tag_name("item")) {
            let id = content_id(item)
                .ok_or_else(|| structure_error(save_path, "equipment <item> has no content ID"))?;
            equipment.push(ImportedItem {
                content_id: id.to_owned(),
                saved_name: item.attribute("name").map(str::to_owned),
                definition: definitions.get(id).map(|element| ContentDefinition {
                    name: element.attribute("name").map(str::to_owned),
                    kind: element.attribute("type").map(str::to_owned),
                    source: element.attribute("source").map(str::to_owned),
                }),
            });
        }
    }

    Ok(ImportedCharacter { name, equipment })
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

fn content_id<'a>(node: Node<'a, '_>) -> Option<&'a str> {
    node.attribute("id").filter(|id| !id.trim().is_empty())
}

fn structure_error(path: &Path, message: impl Into<String>) -> ImportError {
    ImportError::Structure {
        path: path.to_owned(),
        message: message.into(),
    }
}
