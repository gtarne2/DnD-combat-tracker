use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
};

use roxmltree::{Document, Node};

mod content;
mod currency;
mod profile;
mod rolls;

pub use content::{ContentDefinition, ContentElement, ContentNode};
pub use currency::AuroraCurrency;
pub(crate) use currency::{CurrencyPart, DENOMINATIONS};
pub use profile::{ABILITIES, CharacterProfile, KeyStats, ProfileField, ProfileSection};
pub use rolls::{RollBonuses, RollModifier, RollProficiency, SKILLS, ToolProficiency};

use content::ContentIndex;

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedCharacter {
    pub name: Option<String>,
    pub currency: Option<AuroraCurrency>,
    pub profile: CharacterProfile,
    pub spell_slots: SpellSlots,
    pub spellcasting: Vec<SpellcastingStats>,
    pub attacks: Vec<ImportedAttack>,
    pub equipment: Vec<ImportedItem>,
    pub spells: Vec<ImportedReference>,
    pub build_elements: Vec<ImportedReference>,
    pub companions: Vec<ImportedReference>,
    pub class_levels: BTreeMap<String, u32>,
    pub active_ids: BTreeSet<String>,
    pub infusions: Vec<(String, String)>,
    /// Definitions reachable from the save. A present key with no value marks missing content.
    pub definitions: BTreeMap<String, Option<ContentDefinition>>,
    pub companion_definitions: BTreeMap<String, Option<ContentDefinition>>,
    /// Generated scroll IDs mapped to their spell when the supplied content identifies it uniquely.
    pub generated_scroll_spells: BTreeMap<String, String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SpellSlots {
    pub standard: [u16; 9],
    pub pact: [u16; 9],
}

impl ImportedCharacter {
    /// Features recorded in the save's selections or calculated build summary.
    pub fn features(&self) -> impl Iterator<Item = &ImportedReference> {
        self.build_elements
            .iter()
            .filter(|reference| reference.kind().is_some_and(is_feature_kind))
    }
}

pub(crate) fn is_feature_kind(kind: &str) -> bool {
    matches!(
        kind,
        "Feat" | "Feature" | "Racial Trait" | "Companion Trait"
    ) || kind.ends_with(" Feature")
}

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedAttack {
    pub identifier: Option<String>,
    pub item_id: Option<String>,
    pub name: String,
    pub range: Option<String>,
    pub attack: Option<String>,
    pub damage: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpellcastingStats {
    pub name: Option<String>,
    pub source_id: Option<String>,
    pub ability: Option<String>,
    pub attack_bonus: Option<i16>,
    pub save_dc: Option<u16>,
}

impl SpellcastingStats {
    fn read(node: Node<'_, '_>) -> Self {
        let attribute = |key| nonempty(node.attribute(key)).map(str::to_owned);
        Self {
            name: attribute("name"),
            source_id: attribute("source"),
            ability: attribute("ability"),
            attack_bonus: node
                .attribute("attack")
                .and_then(|value| value.trim().parse().ok()),
            save_dc: node
                .attribute("dc")
                .and_then(|value| value.trim().parse().ok()),
        }
    }
}

pub type ImportedItem = ImportedReference;

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedReference {
    pub content_id: String,
    pub saved_name: Option<String>,
    pub saved_kind: Option<String>,
    pub saved_spell_level: Option<u8>,
    pub preparation: Option<bool>,
    pub spellcasting: Option<SpellcastingStats>,
    pub inventory: Option<InventoryEntry>,
    /// None when the supplied XML has no definition for this ID.
    pub definition: Option<ContentDefinition>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct InventoryEntry {
    pub identifier: Option<String>,
    pub equipped: bool,
    pub notes: Option<String>,
    /// A missing amount attribute represents one unit. A malformed amount is unknown.
    pub quantity: Option<u32>,
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

    let attacks = child(build, "input")
        .and_then(|input| child(input, "attacks"))
        .into_iter()
        .flat_map(|attacks| children_named(attacks, "attack"))
        .filter(|attack| attack.attribute("displayed") != Some("false"))
        .filter_map(|attack| {
            Some(ImportedAttack {
                identifier: nonempty(attack.attribute("identifier")).map(str::to_owned),
                item_id: nonempty(attack.attribute("item-id")).map(str::to_owned),
                name: nonempty(attack.attribute("name"))?.into(),
                range: nonempty(attack.attribute("range")).map(str::to_owned),
                attack: nonempty(attack.attribute("attack")).map(str::to_owned),
                damage: nonempty(attack.attribute("damage")).map(str::to_owned),
                description: child(attack, "description")
                    .and_then(|description| nonempty(description.text()))
                    .map(str::to_owned),
            })
        })
        .collect();

    let equipment = children_named(build, "equipment")
        .flat_map(|items| children_named(items, "item"))
        .map(|item| {
            SavedReference::from_node(item)
                .ok_or_else(|| structure_error(save_path, "equipment <item> has no content ID"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut build_elements: Vec<_> = children_named(build, "elements")
        .flat_map(|elements| elements.descendants())
        .filter(|node| node.has_tag_name("element"))
        .filter_map(SavedReference::from_node)
        .collect();

    let active: Vec<_> = children_named(build, "sum")
        .flat_map(|summary| children_named(summary, "element"))
        .filter_map(SavedReference::from_node)
        .collect();
    let active_ids = active.iter().map(|entry| entry.id.to_owned()).collect();
    let saved_levels: Vec<_> = build_elements
        .iter()
        .filter(|entry| entry.kind == Some("Level"))
        .collect();
    let classes: BTreeSet<_> = active
        .iter()
        .chain(&build_elements)
        .filter(|entry| entry.kind == Some("Class"))
        .map(|entry| entry.id)
        .collect();
    let mut class_levels = BTreeMap::new();
    for entry in &saved_levels {
        if let Some(class) = nonempty(entry.node.attribute("class")) {
            *class_levels.entry(class.to_owned()).or_insert(0) += 1;
        }
    }
    if let Some(&class) = classes.first().filter(|_| classes.len() == 1) {
        let level = child(save.root_element(), "display-properties")
            .and_then(|display| child(display, "level"))
            .and_then(|level| level.text()?.trim().parse::<u32>().ok())
            .filter(|level| *level > 0)
            .unwrap_or(saved_levels.len() as u32);
        if level > 0 {
            class_levels.insert(class.to_owned(), level);
        }
    } else if class_levels.values().sum::<u32>() != saved_levels.len() as u32 {
        class_levels.clear();
    }
    let mut build_ids: HashSet<_> = build_elements.iter().map(|entry| entry.id).collect();
    build_elements.extend(active.iter().copied().filter(|entry| {
        entry
            .kind
            .is_some_and(|kind| kind == "Weapon" || is_feature_kind(kind))
            && build_ids.insert(entry.id)
    }));

    let casting =
        || children_named(build, "magic").flat_map(|magic| children_named(magic, "spellcasting"));
    let mut spell_slots = SpellSlots::default();
    let mut spellcasting = Vec::new();
    for caster in casting() {
        let stats = SpellcastingStats::read(caster);
        if (stats.attack_bonus.is_some()
            || stats.save_dc.is_some()
            || stats.ability.is_some()
            || caster.children().any(|list| {
                matches!(list.tag_name().name(), "cantrips" | "spells")
                    && children_named(list, "spell").next().is_some()
            }))
            && !spellcasting.contains(&stats)
        {
            spellcasting.push(stats);
        }
        let Some(slots) = child(caster, "slots") else {
            continue;
        };
        let pact = ["name", "source"].iter().any(|attribute| {
            caster
                .attribute(*attribute)
                .is_some_and(|value| value.to_ascii_lowercase().contains("warlock"))
        });
        let pool = if pact {
            &mut spell_slots.pact
        } else {
            &mut spell_slots.standard
        };
        for (index, total) in pool.iter_mut().enumerate() {
            let name = format!("s{}", index + 1);
            if let Some(amount) = slots
                .attribute(name.as_str())
                .and_then(|value| value.trim().parse::<u16>().ok())
            {
                *total = (*total).max(amount);
            }
        }
    }
    let mut spells: Vec<_> = casting()
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

    let mut companion_ids = HashSet::new();
    let companions: Vec<_> = children_named(build, "companion")
        .filter_map(SavedReference::from_node)
        .chain(build_elements.iter().copied().filter(|element| {
            element.kind == Some("Companion")
                || element.node.parent_element().is_some_and(|parent| {
                    parent.has_tag_name("element") && parent.attribute("type") == Some("Companion")
                })
        }))
        .chain(
            active
                .iter()
                .copied()
                .filter(|entry| entry.kind == Some("Companion")),
        )
        .filter(|entry| companion_ids.insert(entry.id))
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

    let generated_scroll_spells: BTreeMap<_, _> = equipment
        .iter()
        .filter_map(|item| {
            let spell_id = index.generated_scroll_spell(item.id)?;
            Some((item.id.to_owned(), spell_id.to_owned()))
        })
        .collect();

    let infusion_ids: BTreeSet<_> = child(build, "elements")
        .into_iter()
        .flat_map(|elements| elements.descendants())
        .filter(|node| node.has_tag_name("element"))
        .filter(|node| {
            node.attribute("name").is_some_and(|name| {
                name == "Artificer Infusion" || name.starts_with("Artificer Infusion, ")
            })
        })
        .filter_map(|node| node.attribute("registered"))
        .collect();
    let roots = equipment
        .iter()
        .chain(&spells)
        .chain(&build_elements)
        .chain(&companions)
        .chain(&active)
        .map(|reference| reference.id)
        .chain(
            build_elements
                .iter()
                .filter(|reference| reference.kind == Some("Level"))
                .filter_map(|reference| reference.node.attribute("class"))
                .filter(|id| !id.trim().is_empty()),
        )
        .chain(infusion_ids.iter().copied())
        .map(str::to_owned)
        .chain(generated_scroll_spells.values().cloned())
        .collect();
    let definitions = index.resolve_graph(roots);
    let companion_definitions = index.resolve_companions();
    let profile = profile::read_profile(save.root_element(), build, &active, &definitions);
    let infusions = infusion_ids
        .iter()
        .copied()
        .filter(|id| {
            !infusion_ids.iter().any(|choice| {
                choice
                    .strip_prefix(id)
                    .is_some_and(|tail| tail.starts_with("_OPTION_"))
            })
        })
        .map(|id| {
            let name = definitions
                .get(id)
                .and_then(Option::as_ref)
                .and_then(|definition| definition.name.clone())
                .unwrap_or_else(|| {
                    id.split_once("_INFUSION_")
                        .or_else(|| id.split_once("_INFUSTION_"))
                        .map_or(id, |(_, suffix)| suffix)
                        .replace('_', " ")
                });
            (id.to_owned(), name)
        })
        .collect();
    let resolve = |references: Vec<SavedReference<'_, '_>>| {
        references
            .into_iter()
            .map(|reference| ImportedReference {
                content_id: reference.id.to_owned(),
                saved_name: reference.node.attribute("name").map(str::to_owned),
                saved_kind: reference.kind.map(str::to_owned),
                preparation: reference.preparation(),
                saved_spell_level: reference
                    .node
                    .attribute("level")
                    .and_then(|level| level.parse::<u8>().ok())
                    .filter(|level| *level <= 9)
                    .or_else(|| {
                        reference
                            .node
                            .parent_element()
                            .is_some_and(|parent| parent.has_tag_name("cantrips"))
                            .then_some(0)
                    }),
                spellcasting: reference.spellcasting(),
                inventory: reference.node.has_tag_name("item").then(|| InventoryEntry {
                    identifier: nonempty(reference.node.attribute("identifier")).map(str::to_owned),
                    equipped: child(reference.node, "equipped")
                        .and_then(|node| node.text())
                        .map(str::trim)
                        == Some("true"),
                    notes: ["notes", "description"]
                        .into_iter()
                        .find_map(|tag| {
                            child(reference.node, tag).and_then(|node| nonempty(node.text()))
                        })
                        .map(str::to_owned),
                    quantity: reference
                        .node
                        .attribute("amount")
                        .map_or(Some(1), |amount| amount.trim().parse().ok()),
                }),
                definition: definitions
                    .get(reference.id)
                    .and_then(Option::as_ref)
                    .cloned(),
            })
            .collect()
    };

    Ok(ImportedCharacter {
        name,
        currency: AuroraCurrency::read(&save_xml, build, save_path),
        profile,
        spell_slots,
        spellcasting,
        attacks,
        equipment: resolve(equipment),
        spells: resolve(spells),
        build_elements: resolve(build_elements),
        companions: resolve(companions),
        class_levels,
        active_ids,
        infusions,
        definitions,
        companion_definitions,
        generated_scroll_spells,
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

    fn spellcasting(self) -> Option<SpellcastingStats> {
        if !self.node.has_tag_name("spell") {
            return None;
        }
        let casting = self.node.parent_element()?.parent_element()?;
        casting
            .has_tag_name("spellcasting")
            .then(|| SpellcastingStats::read(casting))
    }

    fn preparation(self) -> Option<bool> {
        let list = self.node.parent_element()?;
        if !list.has_tag_name("spells") || self.node.attribute("always-prepared") == Some("true") {
            return None;
        }
        match self.node.attribute("prepared") {
            Some("true") => Some(true),
            Some("false") => Some(false),
            _ if self.node.attribute("known") != Some("true")
                && children_named(list, "spell").any(|spell| {
                    spell.attribute("prepared") == Some("true")
                        && spell.attribute("always-prepared") != Some("true")
                }) =>
            {
                Some(false)
            }
            _ => None,
        }
    }
}

fn nonempty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
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
