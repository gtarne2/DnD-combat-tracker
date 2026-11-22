use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    path::{Path, PathBuf},
};

use roxmltree::{Document, Node};

use super::{ImportError, child, content_id, structure_error};

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct ContentDefinition {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub source: Option<String>,
    pub source_path: PathBuf,
    pub file_version: Option<String>,
    pub element: ContentElement,
    /// Exact IDs named by rules or embedded descriptions. Their data is in the character catalog.
    pub referenced_ids: BTreeSet<String>,
}

impl ContentDefinition {
    pub fn rules(&self) -> impl Iterator<Item = &ContentElement> {
        self.element
            .children_named("rules")
            .flat_map(ContentElement::child_elements)
    }
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct ContentElement {
    pub tag: String,
    pub attributes: BTreeMap<String, String>,
    pub children: Vec<ContentNode>,
}

impl ContentElement {
    pub fn child_elements(&self) -> impl Iterator<Item = &ContentElement> {
        self.children.iter().filter_map(|child| match child {
            ContentNode::Element(element) => Some(element),
            ContentNode::Text(_) => None,
        })
    }

    pub fn children_named<'a>(&'a self, tag: &'a str) -> impl Iterator<Item = &'a ContentElement> {
        self.child_elements().filter(move |child| child.tag == tag)
    }
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum ContentNode {
    Element(ContentElement),
    Text(String),
}

#[derive(Default)]
pub(super) struct ContentIndex<'doc, 'xml> {
    elements: HashMap<&'doc str, DefinitionSource<'doc, 'xml>>,
    appends: HashMap<&'doc str, Vec<Node<'doc, 'xml>>>,
}

struct DefinitionSource<'doc, 'xml> {
    node: Node<'doc, 'xml>,
    path: &'doc Path,
    version: Option<&'doc str>,
}

impl<'doc, 'xml> ContentIndex<'doc, 'xml> {
    pub(super) fn generated_scroll_spell(&self, item_id: &str) -> Option<&'doc str> {
        let suffix = item_id.strip_prefix("ID_INTERNAL_MAGIC_ITEM_SPELL_SCROLL_")?;
        // Aurora's generated scroll ID omits the spell's source prefix.
        let mut matches = self.elements.iter().filter(|&(id, source)| {
            source.node.attribute("type") == Some("Spell")
                && id
                    .split_once("_SPELL_")
                    .is_some_and(|(_, name)| name == suffix)
        });
        let (id, _) = matches.next()?;
        matches.next().is_none().then_some(*id)
    }

    pub(super) fn add_file(
        &mut self,
        path: &'doc Path,
        document: &'doc Document<'xml>,
    ) -> Result<(), ImportError> {
        let root = document.root_element();
        let version = child(root, "info")
            .and_then(|info| child(info, "update"))
            .and_then(|update| update.attribute("version"));
        let mut seen = HashSet::new();
        for node in root.children().filter(Node::is_element) {
            match node.tag_name().name() {
                "element" => {
                    let id = content_id(node)
                        .ok_or_else(|| structure_error(path, "content <element> has no ID"))?;
                    if !seen.insert(id) {
                        return Err(structure_error(path, format!("duplicate content ID {id}")));
                    }
                    self.elements.insert(
                        id,
                        DefinitionSource {
                            node,
                            path,
                            version,
                        },
                    );
                }
                "append" => {
                    let id = content_id(node)
                        .ok_or_else(|| structure_error(path, "content <append> has no ID"))?;
                    self.appends.entry(id).or_default().push(node);
                }
                _ => {}
            }
        }
        Ok(())
    }

    pub(super) fn resolve_graph(
        &self,
        mut pending: Vec<String>,
    ) -> BTreeMap<String, Option<ContentDefinition>> {
        let mut definitions = BTreeMap::new();
        while let Some(id) = pending.pop() {
            if definitions.contains_key(&id) {
                continue;
            }
            let definition = self.resolve(&id);
            if let Some(definition) = &definition {
                pending.extend(definition.referenced_ids.iter().cloned());
            }
            definitions.insert(id, definition);
        }
        definitions
    }

    fn resolve(&self, id: &str) -> Option<ContentDefinition> {
        let source = self.elements.get(id)?;
        let mut element = read_element(source.node);
        for append in self.appends.get(id).into_iter().flatten() {
            element.children.extend(
                append
                    .children()
                    .filter(|node| node.has_tag_name("supports") || node.has_tag_name("rules"))
                    .map(read_element)
                    .map(ContentNode::Element),
            );
        }

        let mut referenced_ids = BTreeSet::new();
        collect_references(&element, &mut referenced_ids);
        Some(ContentDefinition {
            name: source.node.attribute("name").map(str::to_owned),
            kind: source.node.attribute("type").map(str::to_owned),
            source: source.node.attribute("source").map(str::to_owned),
            source_path: source.path.to_owned(),
            file_version: source.version.map(str::to_owned),
            element,
            referenced_ids,
        })
    }
}

fn collect_references(element: &ContentElement, references: &mut BTreeSet<String>) {
    let rule_target = match element.tag.as_str() {
        "grant" | "select" => element.attributes.get("id"),
        _ => None,
    };
    for id in [rule_target, element.attributes.get("element")]
        .into_iter()
        .flatten()
    {
        if !id.trim().is_empty() {
            references.insert(id.clone());
        }
    }
    for child in element.child_elements() {
        collect_references(child, references);
    }
}

fn read_element(node: Node<'_, '_>) -> ContentElement {
    ContentElement {
        tag: node.tag_name().name().to_owned(),
        attributes: node
            .attributes()
            .map(|attr| (attr.name().to_owned(), attr.value().to_owned()))
            .collect(),
        children: node
            .children()
            .filter_map(|child| match child.node_type() {
                roxmltree::NodeType::Element => Some(ContentNode::Element(read_element(child))),
                roxmltree::NodeType::Text => {
                    child.text().map(|text| ContentNode::Text(text.to_owned()))
                }
                _ => None,
            })
            .collect(),
    }
}
