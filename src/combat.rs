use std::collections::{HashSet, VecDeque};

use crate::aurora::{
    AuroraCurrency, CharacterProfile, ContentDefinition, ContentElement, ContentNode,
    ImportedCharacter, SpellcastingStats, is_feature_kind,
};
use crate::companion::{CompanionRoster, CompanionTemplate, companion_templates};
use crate::concentration::ConcentrationSpell;
use crate::encounter::EncounterProgress;
use crate::inventory::{ConsumableUses, consumable_amounts, consumable_key, is_scroll};

mod feature_rules;
mod html;
mod infusion;
mod moxie;
mod spell_options;
mod spell_scaling;

pub use html::{render_html, render_html_with_profile};
pub use spell_options::{
    AreaShape, SpellArea, SpellSave, area as spell_area, damage_type as spell_damage_type,
    spell_save,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionGroup {
    Action,
    BonusAction,
    Reaction,
    Other,
}

impl ActionGroup {
    const ALL: [Self; 4] = [Self::Action, Self::BonusAction, Self::Reaction, Self::Other];

    pub fn label(self) -> &'static str {
        match self {
            Self::Action => "Action",
            Self::BonusAction => "Bonus Action",
            Self::Reaction => "Reaction",
            Self::Other => "Other options",
        }
    }

    fn from_label(label: &str) -> Option<Self> {
        let label = label.trim().to_ascii_lowercase();
        let label = label.strip_prefix("1 ").unwrap_or(&label);
        match label.split([',', '(', '—', ';']).next()?.trim() {
            "action" => Some(Self::Action),
            "bonus action" => Some(Self::BonusAction),
            "reaction" => Some(Self::Reaction),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptionKind {
    Attack,
    Spell,
    Scroll,
    Item,
    Feature,
}

impl OptionKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Attack => "Attack",
            Self::Spell => "Spell",
            Self::Scroll => "Scroll",
            Self::Item => "Item",
            Self::Feature => "Feature",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatOption {
    pub name: String,
    pub spell_level: Option<u8>,
    pub preparation: Option<bool>,
    pub heat_metal: bool,
    pub guidance: bool,
    pub ritual: bool,
    pub pin_key: Option<String>,
    pub kind: OptionKind,
    pub details: Vec<CombatDetail>,
    pub description: Vec<ContentNode>,
    pub inventory: Option<InventoryListing>,
    pub inventory_key: Option<String>,
    pub linked_item: Option<String>,
    pub summary: Option<String>,
    pub moxie: Option<moxie::MoxieUse>,
    pub artificer_damage: bool,
    pub consumable: Option<ConsumableAmount>,
    pub charge_cost: Option<u32>,
    pub cast_previews: Vec<String>,
    pub spell_options: spell_options::SpellOptions,
    pub attunement: Option<String>,
    pub initially_attuned: bool,
    pub hit_maneuver: bool,
    pub resource_binding: Option<feature_rules::ResourceBinding>,
    pub feature_level_available: bool,
    pub concentration: Option<ConcentrationSpell>,
    /// A feature that creates companion variants, such as Eldritch Cannon.
    pub summon: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InventoryListing {
    pub index: usize,
    pub quantity: Option<u32>,
    pub equipped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsumableAmount {
    pub key: String,
    pub remaining: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatDetail {
    pub label: &'static str,
    pub value: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CombatGroup {
    pub action: ActionGroup,
    pub options: Vec<CombatOption>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CombatSheet {
    pub character_name: Option<String>,
    pub currency: Option<AuroraCurrency>,
    pub profile: CharacterProfile,
    pub groups: [CombatGroup; 4],
    pub companion_templates: Vec<CompanionTemplate>,
    pub companions: CompanionRoster,
    pub progress: EncounterProgress,
    pub resources: Vec<CombatResource>,
    pub casting_rolls: Vec<SpellcastingStats>,
    pub infusions: Vec<(String, String)>,
    pub reference_features: Vec<CombatOption>,
    pub infusion_attacks: std::collections::BTreeMap<String, infusion::InfusionAttack>,
    pub arcane_firearm: bool,
    pub attacks_per_action: u32,
    pub sneak_attack: Option<String>,
    definitions: Vec<ImportDefinition>,
}

#[derive(Debug, PartialEq, Eq)]
struct ImportDefinition {
    id: String,
    name: String,
    source: Option<String>,
    fingerprint: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CombatResource {
    pub key: String,
    pub name: String,
    pub capacity: u32,
    pub recovery: &'static str,
    pub recharge_die: Option<u32>,
    pub dawn_recharge: Option<(u32, u32)>,
}

fn import_definitions(character: &ImportedCharacter) -> Vec<ImportDefinition> {
    use std::hash::{DefaultHasher, Hash, Hasher};

    let sources: std::collections::BTreeMap<_, _> = character
        .definitions
        .iter()
        .chain(&character.companion_definitions)
        .collect();
    sources
        .into_iter()
        .map(|(id, definition)| {
            let mut hash = DefaultHasher::new();
            let mut name = id.clone();
            let source = definition.as_ref().map(|definition| {
                if let Some(label) = &definition.name {
                    name.clone_from(label);
                }
                format!("{:?}", definition.element).hash(&mut hash);
                let path = definition.source_path.to_string_lossy();
                match &definition.file_version {
                    Some(version) => format!("{path} · version {version}"),
                    None => path.into_owned(),
                }
            });
            ImportDefinition {
                id: id.clone(),
                name,
                source,
                fingerprint: format!("{:016x}", hash.finish()),
            }
        })
        .collect()
}

impl CombatSheet {
    pub fn from_character(character: &ImportedCharacter) -> Self {
        Self::with_consumable_uses(character, &ConsumableUses::default())
    }

    pub(crate) fn with_consumable_uses(
        character: &ImportedCharacter,
        uses: &ConsumableUses,
    ) -> Self {
        let mut companions = CompanionRoster::default();
        companions.sync_imported(character);
        let mut sheet = Self {
            character_name: character.name.clone(),
            currency: character.currency.clone(),
            profile: character.profile.clone(),
            companion_templates: companion_templates(character),
            companions,
            progress: EncounterProgress::default(),
            resources: Vec::new(),
            casting_rolls: character.spellcasting.clone(),
            infusions: character.infusions.clone(),
            reference_features: Vec::new(),
            infusion_attacks: infusion::attack_bonuses(character),
            arcane_firearm: false,
            attacks_per_action: feature_rules::attacks_per_action(character),
            sneak_attack: feature_rules::sneak_attack(character),
            definitions: import_definitions(character),
            groups: ActionGroup::ALL.map(|action| CombatGroup {
                action,
                options: Vec::new(),
            }),
        };
        let mut item_counts = std::collections::BTreeMap::new();
        let item_keys: Vec<_> = character
            .equipment
            .iter()
            .map(|item| {
                if let Some(id) = item
                    .inventory
                    .as_ref()
                    .and_then(|entry| entry.identifier.as_deref())
                {
                    return format!("item:{}:{id}", item.content_id);
                }
                let occurrence = item_counts.entry(item.content_id.as_str()).or_insert(0);
                *occurrence += 1;
                format!("item:{}:entry-{occurrence}", item.content_id)
            })
            .collect();
        for attack in &character.attacks {
            let mut option = CombatOption::new(OptionKind::Attack, &attack.name);
            option.pin_key = attack
                .identifier
                .as_ref()
                .map(|id| format!("saved-attack:{id}"));
            option.detail("Range", attack.range.as_deref());
            option.detail("Attack roll", attack.attack.as_deref());
            option.detail("Damage", attack.damage.as_deref());
            let candidates = |matches: &dyn Fn(&crate::aurora::ImportedReference) -> bool| {
                let mut rows = character
                    .equipment
                    .iter()
                    .enumerate()
                    .filter(|(_, item)| matches(item));
                let first = rows.next()?.0;
                rows.next().is_none().then_some(first)
            };
            let linked = if let Some(id) = &attack.item_id {
                candidates(&|item| {
                    &item.content_id == id
                        || item
                            .inventory
                            .as_ref()
                            .and_then(|entry| entry.identifier.as_ref())
                            == Some(id)
                })
            } else {
                let by_identifier = attack.identifier.as_ref().and_then(|id| {
                    candidates(&|item| {
                        item.inventory
                            .as_ref()
                            .and_then(|entry| entry.identifier.as_ref())
                            == Some(id)
                    })
                });
                by_identifier.or_else(|| {
                    candidates(&|item| {
                        item.saved_name
                            .as_deref()
                            .or_else(|| item.definition.as_ref()?.name.as_deref())
                            .is_some_and(|name| name.eq_ignore_ascii_case(&attack.name))
                    })
                })
            };
            option.linked_item = linked.map(|index| item_keys[index].clone());
            if let Some(description) = &attack.description {
                option
                    .description
                    .push(ContentNode::Text(description.clone()));
            }
            sheet.push(ActionGroup::Action, option);
        }
        for spell in &character.spells {
            sheet.add_definition(
                character,
                DefinitionOption {
                    id: &spell.content_id,
                    name: spell.saved_name.as_deref(),
                    definition: spell.definition.as_ref(),
                    linked_spell: None,
                    spellcasting: spell.spellcasting.as_ref(),
                    saved_spell_level: spell.saved_spell_level,
                    preparation: spell.preparation,
                    kind: OptionKind::Spell,
                    inventory: None,
                    consumable: None,
                },
            );
        }
        let mut amounts = consumable_amounts(character);
        for (index, item) in character.equipment.iter().enumerate() {
            let consumable = if let Some(key) = consumable_key(item) {
                let Some(amount) = amounts.remove(&key) else {
                    continue;
                };
                Some(ConsumableAmount {
                    remaining: uses.remaining(&key, amount),
                    key,
                })
            } else {
                None
            };
            let definition = item.definition.as_ref();
            let kind = if is_scroll(&item.content_id, definition) {
                OptionKind::Scroll
            } else if item
                .kind()
                .is_some_and(|kind| matches!(kind, "Weapon" | "Magic Weapon"))
                || setter(definition, "type").as_deref() == Some("Weapon")
            {
                OptionKind::Attack
            } else {
                OptionKind::Item
            };
            sheet.add_definition(
                character,
                DefinitionOption {
                    id: &item.content_id,
                    name: item.saved_name.as_deref(),
                    definition,
                    linked_spell: (kind == OptionKind::Scroll)
                        .then(|| scroll_spell(character, &item.content_id, definition))
                        .flatten(),
                    spellcasting: None,
                    saved_spell_level: None,
                    preparation: None,
                    kind,
                    inventory: Some(InventoryListing {
                        index,
                        quantity: item.inventory.as_ref().and_then(|entry| entry.quantity),
                        equipped: item.inventory.as_ref().is_some_and(|entry| entry.equipped),
                    }),
                    consumable,
                },
            );
        }
        let equipment_ids: HashSet<_> = character
            .equipment
            .iter()
            .map(|item| item.content_id.as_str())
            .collect();
        for weapon in character.build_elements.iter().filter(|entry| {
            entry.kind() == Some("Weapon") && !equipment_ids.contains(entry.content_id.as_str())
        }) {
            sheet.add_definition(
                character,
                DefinitionOption {
                    id: &weapon.content_id,
                    name: weapon.saved_name.as_deref(),
                    definition: weapon.definition.as_ref(),
                    linked_spell: None,
                    spellcasting: None,
                    saved_spell_level: None,
                    preparation: None,
                    kind: OptionKind::Attack,
                    inventory: None,
                    consumable: None,
                },
            );
        }
        sheet.add_features(character);
        sheet.arcane_firearm = sheet
            .groups
            .iter()
            .flat_map(|group| &group.options)
            .chain(&sheet.reference_features)
            .any(|entry| {
                entry.pin_key.as_deref().is_some_and(|id| {
                    id.starts_with("Feature:") && id.ends_with("_ARTILLERIST_ARCANE_FIREARM")
                })
            });
        let mut charges = std::collections::BTreeMap::new();
        for option in sheet.groups.iter_mut().flat_map(|group| &mut group.options) {
            option.artificer_damage &= sheet.arcane_firearm;
            if let Some(item) = option.inventory {
                option.inventory_key = Some(item_keys[item.index].clone());
                if option.consumable.is_none() {
                    option.charge_cost = option
                        .details
                        .iter()
                        .find(|detail| detail.label == "Cost")
                        .and_then(|detail| charge_cost(&detail.value));
                    if (option.charge_cost.is_some()
                        || setter(
                            character.equipment[item.index].definition.as_ref(),
                            "charges",
                        )
                        .is_some()
                        || plain_text(&option.description)
                            .to_ascii_lowercase()
                            .contains("at dawn"))
                        && let Some(pool) = charged_pool(
                            option,
                            character.equipment[item.index].definition.as_ref(),
                        )
                    {
                        if let Some((die, bonus)) = pool.dawn_recharge {
                            let formula = if die == 0 {
                                "All charges".to_owned()
                            } else if bonus > 0 {
                                format!("1d{die} + {bonus} charges")
                            } else {
                                format!("1d{die} charges")
                            };
                            option.detail("Recharge", Some(format!("{formula} at dawn")));
                        }
                        charges
                            .entry(pool.key.clone())
                            .and_modify(|existing: &mut Option<CombatResource>| {
                                if existing.as_ref() != Some(&pool) {
                                    *existing = None;
                                }
                            })
                            .or_insert(Some(pool));
                    }
                }
                if let Some(entry) = &character.equipment[item.index].inventory {
                    if entry.equipped {
                        option.detail("Equipped", Some("Yes"));
                    }
                    option.initially_attuned = entry.attuned;
                    option.detail("Item notes", entry.notes.as_deref());
                }
            }
        }
        sheet.resources = resources(character, &sheet.groups, &sheet.reference_features);
        for option in sheet.groups.iter_mut().flat_map(|group| &mut group.options) {
            if option.feature_level_available
                && let Some(binding) = feature_rules::bind_pool(character, option, &sheet.resources)
                && let Some(pool) = sheet.resources.iter().find(|pool| pool.key == binding.key)
            {
                let usage = binding.cost.map_or_else(
                    || format!("Choose points from {}", pool.name),
                    |cost| format!("{cost} {}", pool.name),
                );
                option.detail("Cost", Some(usage));
                let rules = plain_text(&option.description).to_ascii_lowercase();
                option.hit_maneuver = pool.name == "Superiority Dice"
                    && binding.cost.is_some()
                    && rules.contains("when you hit");
                option.detail(
                    "Save DC",
                    feature_rules::pool_save_dc(character, option, &binding),
                );
                option.resource_binding = Some(binding);
            }
        }
        sheet.resources.extend(charges.into_values().flatten());
        sheet
    }

    fn add_features(&mut self, character: &ImportedCharacter) {
        let mut queue: VecDeque<_> = character
            .features()
            .map(|feature| {
                (
                    &*feature.content_id,
                    feature.saved_name.as_deref(),
                    feature.definition.as_ref(),
                )
            })
            .collect();
        let mut seen = HashSet::new();
        while let Some((id, name, definition)) = queue.pop_front() {
            if !seen.insert(id) {
                continue;
            }
            if let Some(definition) = definition {
                for grant in definition.rules().filter(|rule| rule.tag == "grant") {
                    let attributes = &grant.attributes;
                    // Resolve simple saved-ID prerequisites and leave level-gated grants to the save.
                    if attributes
                        .keys()
                        .any(|key| !matches!(key.as_str(), "id" | "type" | "requirements"))
                        || !moxie::matches_requirements(attr(grant, "requirements"), character)
                        || !attributes
                            .get("type")
                            .is_some_and(|kind| is_feature_kind(kind))
                    {
                        continue;
                    }
                    if let Some(target) = attributes.get("id") {
                        queue.push_back((target, None, lookup(character, target)));
                    }
                }
                let mut sheets = definition.element.children_named("sheet").peekable();
                if sheets.peek().is_some()
                    && sheets.all(|sheet| attr(sheet, "display") == Some("false"))
                {
                    self.reference_features.push(feature_reference(
                        character,
                        id,
                        name,
                        Some(definition),
                    ));
                    continue;
                }
            }
            self.add_definition(
                character,
                DefinitionOption {
                    id,
                    name,
                    definition,
                    linked_spell: None,
                    spellcasting: None,
                    saved_spell_level: None,
                    preparation: None,
                    kind: OptionKind::Feature,
                    inventory: None,
                    consumable: None,
                },
            );
        }
        for (id, name) in &character.infusions {
            if seen.insert(id) {
                self.reference_features.push(feature_reference(
                    character,
                    id,
                    Some(name),
                    lookup(character, id),
                ));
            }
        }
    }

    fn add_definition(&mut self, character: &ImportedCharacter, source: DefinitionOption<'_>) {
        let DefinitionOption {
            id,
            name,
            definition,
            linked_spell,
            spellcasting,
            saved_spell_level,
            preparation,
            kind,
            inventory,
            consumable,
        } = source;
        let name = name
            .or_else(|| definition.and_then(|value| value.name.as_deref()))
            .unwrap_or(id);
        let mut option = CombatOption::new(kind, name);
        option.preparation = preparation;
        option.inventory = inventory;
        option.consumable = consumable;
        option.pin_key = Some(
            match spellcasting.and_then(|casting| casting.source_id.as_deref()) {
                Some(caster) => format!("{}:{id}:{caster}", kind.label()),
                None => format!("{}:{id}", kind.label()),
            },
        );
        let mechanics = linked_spell.or(definition);
        let rules = feature_rules::RuleValues::new(character, id, definition);
        let time = setter(mechanics, "time");
        option.detail("Casting time", time.as_deref());
        option.detail("Range", setter(mechanics, "range"));
        if matches!(kind, OptionKind::Spell | OptionKind::Scroll) {
            option.heat_metal = mechanics
                .and_then(|value| attr(&value.element, "id"))
                .unwrap_or(id)
                .ends_with("_SPELL_HEAT_METAL");
            option.guidance = mechanics
                .and_then(|value| attr(&value.element, "id"))
                .unwrap_or(id)
                .ends_with("_SPELL_GUIDANCE");
            option.spell_level = setter(mechanics, "level")
                .and_then(|level| level.parse::<u8>().ok())
                .filter(|level| *level <= 9)
                .or(saved_spell_level);
            let flag = |key| {
                setter(mechanics, key).is_some_and(|value| value.eq_ignore_ascii_case("true"))
            };
            option.ritual = flag("isRitual")
                || time
                    .as_deref()
                    .is_some_and(|value| value.to_ascii_lowercase().contains("(ritual)"));
            let duration = setter(mechanics, "duration");
            option.detail("Duration", duration.as_deref());
            if kind == OptionKind::Spell {
                let material = setter(mechanics, "materialComponent");
                let components = [
                    ("V", flag("hasVerbalComponent")),
                    ("S", flag("hasSomaticComponent")),
                    ("M", flag("hasMaterialComponent") || material.is_some()),
                ]
                .into_iter()
                .filter_map(|(label, present)| present.then_some(label))
                .collect::<Vec<_>>()
                .join(", ");
                option.detail("Components", Some(components));
                option.detail("Material", material);
            }
            let concentration = setter(mechanics, "isConcentration").map_or_else(
                || {
                    duration.as_deref().is_some_and(|value| {
                        value.to_ascii_lowercase().starts_with("concentration")
                    })
                },
                |flag| flag.eq_ignore_ascii_case("true"),
            );
            if concentration {
                let spell_id = mechanics
                    .and_then(|spell| attr(&spell.element, "id"))
                    .unwrap_or(id);
                let spell_name = linked_spell
                    .and_then(|spell| spell.name.as_deref())
                    .unwrap_or(name);
                option.concentration = Some(ConcentrationSpell::new(
                    spell_id.to_owned(),
                    spell_name.to_owned(),
                    duration,
                ));
            }
        }
        let damage = setter(mechanics, "damage");
        option.detail("Damage", damage.as_deref());

        option.description = description(character, id, definition);
        let text = plain_text(&option.description);
        if kind == OptionKind::Feature {
            option.summary = feature_summary(definition);
            let summary = option.summary.as_deref().unwrap_or(text.as_str());
            option.moxie = moxie::feature_use(id, name, Some(summary), definition);
            if moxie::is_pool(id, name) {
                if let Some(pool) = moxie::pool(character, definition, Some(summary)) {
                    option.summary = Some(format!(
                        "{} Moxie points. Recovers on a {} rest.",
                        pool.capacity,
                        if pool.recovery == "short" {
                            "short or long"
                        } else {
                            "long"
                        }
                    ));
                }
            }
            if let Some(use_kind) = option.moxie {
                option.detail("Trigger", use_kind.trigger);
            }
            if let Some(summary) = &mut option.summary {
                let resolved = rules.interpolate(summary);
                if resolved != *summary && !resolved.contains("{{") {
                    option.detail("At your level", Some(resolved.clone()));
                }
                option.summary = Some(resolved);
            }
        }
        add_reference_facts(&mut option, definition.or(linked_spell));
        if !matches!(kind, OptionKind::Spell | OptionKind::Scroll) {
            option.detail("Duration", setter(definition, "duration"));
        }
        if let Some(spell) = linked_spell {
            let spell_id = attr(&spell.element, "id").unwrap_or(id);
            option
                .description
                .extend(description(character, spell_id, Some(spell)));
        }
        let text = if linked_spell.is_some() {
            plain_text(&option.description)
        } else {
            text
        };
        let lower = text.to_ascii_lowercase();
        if kind == OptionKind::Spell {
            let range = option
                .details
                .iter()
                .find(|detail| detail.label == "Range")
                .map(|detail| detail.value.clone());
            option.spell_options = spell_options::SpellOptions::read(
                &text,
                range.as_deref(),
                time.as_deref(),
                option.spell_level,
                setter(mechanics, "school"),
                setter(mechanics, "materialComponent").as_deref(),
            );
            let spell = linked_spell.or(definition);
            option.spell_options.apply_overlay(
                spell
                    .and_then(|spell| spell.name.as_deref())
                    .unwrap_or(name),
                spell.and_then(|spell| spell.source.as_deref()),
            );
            option.detail("School", option.spell_options.school.clone());
            option.detail("Trigger", option.spell_options.trigger.clone());
        }
        if inventory.is_some() {
            option.attunement = attunement(definition);
            option.detail("Attunement", option.attunement.clone());
        }
        let casting_modifier = spell_scaling::casting_modifier(character, spellcasting);
        let preview = (kind == OptionKind::Spell)
            .then(|| {
                spell_scaling::preview(&text, option.spell_level, character.level, casting_modifier)
            })
            .flatten()
            .filter(|preview| damage.is_none() || preview.label != "Damage");
        if let Some(preview) = preview {
            option.detail(preview.label, Some(preview.roll));
            option.cast_previews = preview.slots;
        } else if damage.is_none() {
            let dice = dice_in(&text);
            if !dice.is_empty() {
                option.detail("Dice in description", Some(dice.join(" · ")));
            }
        }
        option.artificer_damage = kind == OptionKind::Spell
            && spellcasting.is_some_and(|casting| {
                casting
                    .source_id
                    .as_deref()
                    .is_some_and(|id| id.ends_with("_CLASS_ARTIFICER"))
                    || casting
                        .name
                        .as_deref()
                        .is_some_and(|name| name.eq_ignore_ascii_case("Artificer"))
            })
            && (damage.is_some()
                || lower
                    .split(['.', '!', '?', ';'])
                    .any(|clause| clause.contains("damage") && !dice_in(clause).is_empty()));
        let casting_baseline = if kind == OptionKind::Spell {
            casting_modifier
                .zip(character.profile.rolls.proficiency_bonus)
                .and_then(|(modifier, proficiency)| modifier.checked_add(proficiency))
        } else {
            None
        };
        let attack = setter(definition, "attackBonus").or_else(|| {
            if !lower.contains("spell attack") {
                return None;
            }
            spellcasting
                .and_then(|stats| stats.attack_bonus)
                .map(i32::from)
                .or(casting_baseline)
                .map(|bonus| format!("{bonus:+}"))
        });
        let dc = setter(definition, "saveDC").or_else(|| {
            if !lower.contains("saving throw") {
                return None;
            }
            written_save_dc(&lower)
                .or_else(|| spellcasting?.save_dc.map(|dc| dc.to_string()))
                .or_else(|| casting_baseline?.checked_add(8).map(|dc| dc.to_string()))
        });
        option.detail(
            "Attack roll",
            attack.or_else(|| {
                (kind == OptionKind::Scroll && lower.contains("spell attack"))
                    .then(|| "Unavailable".into())
            }),
        );
        option.detail(
            "Save DC",
            dc.or_else(|| {
                (kind == OptionKind::Scroll && lower.contains("saving throw"))
                    .then(|| "Unavailable".into())
            }),
        );

        match kind {
            OptionKind::Spell => {
                if let Some(level) = option.spell_level {
                    if level == 0 {
                        option.detail("Spell slot", Some("Cantrip"));
                    } else {
                        option.detail(
                            "Spell slot",
                            Some(format!("Level {level} when cast normally")),
                        );
                    }
                }
                option.detail(
                    "Spellcasting",
                    spellcasting.and_then(|stats| stats.name.as_deref()),
                );
            }
            OptionKind::Scroll => option.detail("Cost", Some("1 scroll")),
            _ => option.detail(
                "Cost",
                setter(definition, "activationCost").or_else(|| written_charge_cost(&lower)),
            ),
        }

        option.summon = kind == OptionKind::Feature && crate::companion::is_summon(id, definition);
        // The tracker's overlay knows when some features are used; the import's own timing
        // (its time setter or sheet action) still wins.
        let overlay_timing = (kind == OptionKind::Feature)
            .then(|| {
                crate::mechanics::overlay().feature(
                    definition
                        .and_then(|definition| definition.name.as_deref())
                        .unwrap_or(name),
                    definition.and_then(|definition| definition.source.as_deref()),
                )
            })
            .flatten()
            .map(|feature| match feature.activation {
                crate::mechanics::Activation::Action => ActionGroup::Action,
                crate::mechanics::Activation::Bonus => ActionGroup::BonusAction,
                crate::mechanics::Activation::Reaction => ActionGroup::Reaction,
                crate::mechanics::Activation::None => ActionGroup::Other,
            });
        let fallback = match time.as_deref() {
            Some(time) => ActionGroup::from_label(time),
            None if kind == OptionKind::Attack => Some(ActionGroup::Action),
            // Creating an Eldritch Cannon takes an action; its text also mentions the bonus
            // action that activates it, which would otherwise leave it under Other options.
            None if option.summon => Some(ActionGroup::Action),
            None if overlay_timing.is_some() => overlay_timing,
            None => option
                .moxie
                .and_then(|usage| usage.timing)
                .or_else(|| activation_in(&lower)),
        };
        if definition.is_none() && linked_spell.is_none() {
            option.detail("Aurora content", Some("Definition unavailable"));
        }
        let variants = activations(definition, fallback);
        let class_level = (kind == OptionKind::Feature
            && variants.iter().any(|variant| variant.level.is_some()))
        .then(|| rules.class_level())
        .flatten();
        for activation in &variants {
            let level = activation.level.and_then(|level| level.parse::<u32>().ok());
            let available = activation.level.is_none()
                || level
                    .zip(class_level)
                    .is_some_and(|(need, have)| need <= have);
            let higher_variant = class_level.is_some_and(|have| {
                variants.iter().any(|other| {
                    other.group == activation.group
                        && other
                            .level
                            .and_then(|level| level.parse::<u32>().ok())
                            .is_some_and(|minimum| minimum > level.unwrap_or(0) && minimum <= have)
                })
            });
            let lower_variant = !available
                && variants
                    .iter()
                    .any(|other| other.group == activation.group && other.level.is_none());
            if kind == OptionKind::Feature && (higher_variant || lower_variant) {
                continue;
            }
            let mut entry = option.clone();
            entry.feature_level_available = kind != OptionKind::Feature || available;
            if kind == OptionKind::Feature
                && activation.group == ActionGroup::Reaction
                && !entry.details.iter().any(|detail| detail.label == "Trigger")
            {
                let trigger = entry
                    .summary
                    .as_deref()
                    .and_then(feature_reaction_trigger)
                    .or_else(|| feature_reaction_trigger(&text));
                entry.detail("Trigger", trigger);
            }
            entry.detail(
                "Uses",
                activation.usage.map(|usage| {
                    if kind == OptionKind::Feature {
                        rules.interpolate(usage)
                    } else {
                        usage.to_owned()
                    }
                }),
            );
            entry.detail("Level", activation.level);
            self.push(activation.group, entry);
        }
    }

    fn push(&mut self, action: ActionGroup, option: CombatOption) {
        self.groups[action as usize].options.push(option);
    }
}

fn feature_reference(
    character: &ImportedCharacter,
    id: &str,
    name: Option<&str>,
    definition: Option<&ContentDefinition>,
) -> CombatOption {
    let name = name
        .or_else(|| definition.and_then(|definition| definition.name.as_deref()))
        .unwrap_or(id);
    let mut option = CombatOption::new(OptionKind::Feature, name);
    option.pin_key = Some(format!("Feature:{id}"));
    option.description = description(character, id, definition);
    option.summary = feature_summary(definition).map(|summary| {
        feature_rules::RuleValues::new(character, id, definition).interpolate(&summary)
    });
    add_reference_facts(&mut option, definition);
    option.detail("Duration", setter(definition, "duration"));
    option
}

fn feature_summary(definition: Option<&ContentDefinition>) -> Option<String> {
    let definition = definition?;
    definition
        .element
        .children_named("sheet")
        .flat_map(|sheet| sheet.children_named("description"))
        .map(|node| {
            plain_text(&node.children)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .find(|summary| !summary.is_empty())
}

fn add_reference_facts(option: &mut CombatOption, definition: Option<&ContentDefinition>) {
    let Some(definition) = definition else { return };
    option.detail("Source", definition.source.as_deref());
    option.detail(
        "Requirements",
        definition
            .element
            .children_named("prerequisite")
            .next()
            .or_else(|| definition.element.children_named("requirements").next())
            .map(|node| plain_text(&node.children))
            .filter(|value| !value.trim().is_empty()),
    );
}

fn resources(
    character: &ImportedCharacter,
    groups: &[CombatGroup],
    references: &[CombatOption],
) -> Vec<CombatResource> {
    let mut result = Vec::new();
    result.extend(infusion::resources(character));
    let moxie = groups
        .iter()
        .flat_map(|group| &group.options)
        .chain(references)
        .find_map(|option| {
            let id = option.pin_key.as_deref()?.strip_prefix("Feature:")?;
            moxie::is_pool(id, &option.name)
                .then(|| {
                    let definition = lookup(character, id);
                    moxie::pool(
                        character,
                        definition,
                        Some(
                            &feature_summary(definition)
                                .unwrap_or_else(|| plain_text(&option.description)),
                        ),
                    )
                })
                .flatten()
        });
    result.extend(moxie);
    for (pool, levels) in [
        ("Spell slot", &character.spell_slots.standard),
        ("Pact Magic slot", &character.spell_slots.pact),
    ] {
        for (index, &capacity) in levels.iter().enumerate().filter(|(_, total)| **total > 0) {
            let level = index + 1;
            result.push(CombatResource {
                key: format!("{pool}:{level}"),
                name: format!("Level {level} {pool}"),
                capacity: capacity.into(),
                recovery: if pool == "Spell slot" {
                    "long"
                } else {
                    "short"
                },
                recharge_die: None,
                dawn_recharge: None,
            });
        }
    }
    let mut features = std::collections::BTreeMap::new();
    for option in groups
        .iter()
        .flat_map(|group| &group.options)
        .chain(references)
        .filter(|option| option.kind == OptionKind::Feature)
    {
        let Some(key) = &option.pin_key else { continue };
        if !option.feature_level_available {
            continue;
        }
        if let Some(pool) = feature_rules::shared_pool(character, option) {
            if !result.iter().any(|resource| resource.key == pool.key) {
                result.push(pool);
            }
            continue;
        }
        for detail in option
            .details
            .iter()
            .filter(|detail| detail.label == "Uses")
        {
            let Some((amount, period)) = detail.value.split_once('/') else {
                continue;
            };
            let Ok(capacity) = amount.trim().parse::<u32>() else {
                continue;
            };
            if capacity == 0 {
                continue;
            }
            let period = period.to_ascii_lowercase();
            let improved_inspiration = key
                == "Feature:ID_WOTC_PHB_CLASS_FEATURE_BARD_BARDIC_INSPIRATION"
                && character.features().any(|feature| {
                    feature.content_id == "ID_WOTC_PHB_CLASS_FEATURE_BARD_FONT_OF_INSPIRATION"
                        && feature_summary(feature.definition.as_ref()).is_some_and(|text| {
                            text.to_ascii_lowercase().contains("short or long rest")
                        })
                });
            let recovery = if improved_inspiration
                || period.contains("short rest")
                || period.contains("short or long rest")
            {
                "short"
            } else if period.contains("long rest") {
                "long"
            } else {
                ""
            };
            features
                .entry(key)
                .and_modify(|entry: &mut Option<(&str, u32, &str)>| {
                    if entry
                        .is_some_and(|(_, amount, reset)| amount != capacity || reset != recovery)
                    {
                        *entry = None;
                    }
                })
                .or_insert(Some((&option.name, capacity, recovery)));
        }
    }
    result.extend(features.into_iter().filter_map(|(key, entry)| {
        let (name, capacity, recovery) = entry?;
        Some(CombatResource {
            key: key.clone(),
            name: name.to_owned(),
            capacity,
            recovery,
            recharge_die: None,
            dawn_recharge: None,
        })
    }));
    result
}

struct DefinitionOption<'a> {
    id: &'a str,
    name: Option<&'a str>,
    definition: Option<&'a ContentDefinition>,
    linked_spell: Option<&'a ContentDefinition>,
    spellcasting: Option<&'a SpellcastingStats>,
    saved_spell_level: Option<u8>,
    preparation: Option<bool>,
    kind: OptionKind,
    inventory: Option<InventoryListing>,
    consumable: Option<ConsumableAmount>,
}

impl CombatOption {
    fn new(kind: OptionKind, name: &str) -> Self {
        Self {
            name: name.to_owned(),
            summon: false,
            spell_level: None,
            preparation: None,
            heat_metal: false,
            guidance: false,
            ritual: false,
            pin_key: None,
            kind,
            details: Vec::new(),
            description: Vec::new(),
            inventory: None,
            inventory_key: None,
            linked_item: None,
            summary: None,
            moxie: None,
            artificer_damage: false,
            consumable: None,
            charge_cost: None,
            cast_previews: Vec::new(),
            spell_options: Default::default(),
            attunement: None,
            initially_attuned: false,
            hit_maneuver: false,
            resource_binding: None,
            feature_level_available: true,
            concentration: None,
        }
    }

    fn detail(&mut self, label: &'static str, value: Option<impl Into<String>>) {
        if let Some(value) = value {
            let value = value.into();
            if !value.trim().is_empty() {
                self.details.push(CombatDetail { label, value });
            }
        }
    }
}

fn attr<'a>(element: &'a ContentElement, key: &str) -> Option<&'a str> {
    element.attributes.get(key).map(String::as_str)
}

fn setter(definition: Option<&ContentDefinition>, key: &str) -> Option<String> {
    definition?
        .element
        .children_named("setters")
        .flat_map(|setters| setters.children_named("set"))
        .find(|set| attr(set, "name").is_some_and(|name| name.eq_ignore_ascii_case(key)))
        .map(|set| plain_text(&set.children).trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn lookup<'a>(character: &'a ImportedCharacter, id: &str) -> Option<&'a ContentDefinition> {
    character.definitions.get(id)?.as_ref()
}

fn scroll_spell<'a>(
    character: &'a ImportedCharacter,
    id: &str,
    definition: Option<&ContentDefinition>,
) -> Option<&'a ContentDefinition> {
    let mut spells = definition
        .into_iter()
        .flat_map(|def| &def.referenced_ids)
        .filter_map(|reference| lookup(character, reference))
        .filter(|definition| definition.kind.as_deref() == Some("Spell"));
    if let Some(spell) = spells.next() {
        return spells.next().is_none().then_some(spell);
    }
    lookup(character, character.generated_scroll_spells.get(id)?)
}

#[derive(PartialEq, Eq)]
struct Activation<'a> {
    group: ActionGroup,
    usage: Option<&'a str>,
    level: Option<&'a str>,
}

fn activations(
    definition: Option<&ContentDefinition>,
    fallback: Option<ActionGroup>,
) -> Vec<Activation<'_>> {
    let mut result = Vec::new();
    let fallback = fallback.unwrap_or(ActionGroup::Other);
    for sheet in definition
        .into_iter()
        .flat_map(|def| def.element.children_named("sheet"))
    {
        if attr(sheet, "display") == Some("false") {
            continue;
        }
        let action = attr(sheet, "action");
        let usage = attr(sheet, "usage");
        let mut descriptions = sheet.children_named("description").peekable();
        if descriptions.peek().is_none() {
            add_activation(&mut result, action, usage, None, fallback);
        }
        for description in descriptions {
            add_activation(
                &mut result,
                attr(description, "action").or(action),
                attr(description, "usage").or(usage),
                attr(description, "level"),
                fallback,
            );
        }
    }
    if result.is_empty() {
        add_activation(&mut result, None, None, None, fallback);
    }
    result
}

fn add_activation<'a>(
    list: &mut Vec<Activation<'a>>,
    action: Option<&str>,
    usage: Option<&'a str>,
    level: Option<&'a str>,
    fallback: ActionGroup,
) {
    let group = action.map_or(fallback, |action| {
        ActionGroup::from_label(action).unwrap_or(ActionGroup::Other)
    });
    let variant = Activation {
        group,
        usage,
        level,
    };
    if !list.contains(&variant) {
        list.push(variant);
    }
}

fn feature_reaction_trigger(text: &str) -> Option<String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    text.split(['.', '!', '?']).find_map(|sentence| {
        let sentence = sentence.trim();
        let lower = sentence.to_ascii_lowercase();
        if !lower.starts_with("when ") && !lower.starts_with("if ") {
            return None;
        }
        let end = [
            ", you can use your reaction",
            ", you can use a reaction",
            ", you can use your own reaction",
            ", you can expend your reaction",
        ]
        .iter()
        .find_map(|phrase| lower.find(phrase))?;
        Some(sentence[..end].to_owned())
    })
}

fn activation_in(text: &str) -> Option<ActionGroup> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut matches = [
        (
            ActionGroup::Action,
            [
                "you can use an action",
                "as an action, you can",
                "you can use your action",
            ],
        ),
        (
            ActionGroup::BonusAction,
            [
                "you can use a bonus action",
                "as a bonus action, you can",
                "you can use your bonus action",
            ],
        ),
        (
            ActionGroup::Reaction,
            [
                "you can use a reaction",
                "as a reaction, you can",
                "you can use your reaction",
            ],
        ),
    ]
    .into_iter()
    .filter(|(_, phrases)| phrases.iter().any(|phrase| normalized.contains(phrase)));
    let (group, _) = matches.next()?;
    matches.next().is_none().then_some(group)
}

fn description(
    character: &ImportedCharacter,
    id: &str,
    definition: Option<&ContentDefinition>,
) -> Vec<ContentNode> {
    let Some(definition) = definition else {
        return Vec::new();
    };
    let mut contents = vec![];
    expand_description(character, definition, &mut vec![id], &mut contents);
    contents
}

fn expand_description<'a>(
    character: &'a ImportedCharacter,
    definition: &'a ContentDefinition,
    active: &mut Vec<&'a str>,
    output: &mut Vec<ContentNode>,
) {
    let mut full = definition.element.children_named("description").peekable();
    if full.peek().is_some() {
        for description in full {
            expand_nodes(character, &description.children, active, output);
        }
    } else {
        for sheet in definition.element.children_named("sheet") {
            for description in sheet.children_named("description") {
                let mut paragraph = ContentElement {
                    tag: "p".to_owned(),
                    attributes: Default::default(),
                    children: Vec::new(),
                };
                if let Some(level) = attr(description, "level") {
                    paragraph
                        .children
                        .push(ContentNode::Text(format!("Level {level}: ")));
                }
                expand_nodes(
                    character,
                    &description.children,
                    active,
                    &mut paragraph.children,
                );
                output.push(ContentNode::Element(paragraph));
            }
        }
    }
}

fn expand_nodes<'a>(
    character: &'a ImportedCharacter,
    nodes: &'a [ContentNode],
    active: &mut Vec<&'a str>,
    output: &mut Vec<ContentNode>,
) {
    for node in nodes {
        match node {
            ContentNode::Text(_) => output.push(node.clone()),
            ContentNode::Element(element) => {
                if let Some(id) = attr(element, "element") {
                    if !active.contains(&id) {
                        if let Some(embedded) = lookup(character, id) {
                            active.push(id);
                            expand_description(character, embedded, active, output);
                            active.pop();
                        } else {
                            output.push(ContentNode::Text(format!(
                                "Linked description unavailable ({id})."
                            )));
                        }
                    }
                } else {
                    let mut children = Vec::new();
                    expand_nodes(character, &element.children, active, &mut children);
                    output.push(ContentNode::Element(ContentElement {
                        tag: element.tag.clone(),
                        attributes: element.attributes.clone(),
                        children,
                    }));
                }
            }
        }
    }
}

fn plain_text(nodes: &[ContentNode]) -> String {
    let mut text = String::new();
    for node in nodes {
        match node {
            ContentNode::Text(value) => text.push_str(value),
            ContentNode::Element(element) => {
                text.push_str(&plain_text(&element.children));
                if matches!(
                    element.tag.as_str(),
                    "p" | "div" | "li" | "tr" | "td" | "br"
                ) {
                    text.push(' ');
                }
            }
        }
    }
    text
}

fn dice_in(text: &str) -> Vec<&str> {
    let mut seen = HashSet::new();
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| {
            token.split_once(['d', 'D']).is_some_and(|(count, sides)| {
                !count.is_empty()
                    && !sides.is_empty()
                    && count.bytes().all(|ch| ch.is_ascii_digit())
                    && sides.bytes().all(|ch| ch.is_ascii_digit())
            })
        })
        .filter(|token| seen.insert(token.to_ascii_lowercase()))
        .collect()
}

fn written_save_dc(text: &str) -> Option<String> {
    let tokens = words(text);
    let mut numbers = tokens
        .windows(2)
        .filter(|pair| pair[0] == "dc")
        .filter_map(|pair| pair[1].parse::<u16>().ok());
    let first = numbers.next()?;
    numbers.all(|dc| dc == first).then(|| first.to_string())
}

fn written_charge_cost(text: &str) -> Option<String> {
    let tokens = words(text);
    let mut charges = tokens.iter().enumerate().filter_map(|(index, verb)| {
        if !matches!(*verb, "spend" | "spending" | "expend" | "expending") {
            return None;
        }
        let (amount, tail) = tokens.get(index + 1..)?.split_first()?;
        if !matches!(
            tail,
            ["charge" | "charges", ..] | ["of", "its", "charges", ..]
        ) {
            return None;
        }
        spell_options::count(amount)
    });
    let first = charges.next()?;
    charges.all(|amount| amount == first).then(|| {
        if first == 1 {
            "1 charge".to_owned()
        } else {
            format!("{first} charges")
        }
    })
}

fn charge_cost(label: &str) -> Option<u32> {
    let label = label.to_ascii_lowercase();
    let tokens = words(&label);
    let [amount, unit] = tokens.as_slice() else {
        return None;
    };
    if !matches!(*unit, "charge" | "charges") {
        return None;
    }
    let amount = match *amount {
        "one" => 1,
        "two" => 2,
        "three" => 3,
        value => value.parse().ok()?,
    };
    (amount > 0).then_some(amount)
}

fn charged_pool(
    option: &CombatOption,
    definition: Option<&ContentDefinition>,
) -> Option<CombatResource> {
    let key = option.inventory_key.as_deref()?;
    let usage = option
        .details
        .iter()
        .find(|detail| detail.label == "Uses")
        .and_then(|detail| detail.value.split_once('/'));
    let description = plain_text(&option.description).to_ascii_lowercase();
    let tokens = words(&description);
    let dawn_recharge = dawn_formula(&description);
    let capacity = setter(definition, "charges")
        .and_then(|value| value.trim().parse::<u32>().ok())
        .or_else(|| usage.and_then(|(value, _)| value.trim().parse().ok()))
        .or_else(|| {
            tokens.windows(3).find_map(|phrase| match phrase {
                ["has", value, "charges"] => spell_options::count(value),
                _ => None,
            })
        })?;
    let recovery = usage.map_or("", |(_, period)| {
        match period.trim().to_ascii_lowercase().as_str() {
            "short rest" | "short or long rest" => "short",
            "long rest" | "day" => "long",
            _ => "",
        }
    });
    (capacity > 0).then(|| CombatResource {
        key: format!("Charge:{key}"),
        name: format!("{} charges", option.name),
        capacity,
        recovery: if dawn_recharge.is_some() {
            "dawn"
        } else {
            recovery
        },
        recharge_die: None,
        dawn_recharge,
    })
}

fn dawn_formula(description: &str) -> Option<(u32, u32)> {
    description.split(['.', '!', '?']).find_map(|sentence| {
        if !sentence.contains("at dawn") {
            return None;
        }
        let (_, recovery) = sentence
            .split_once("regains ")
            .or_else(|| sentence.split_once("regain "))?;
        let (formula, _) = recovery
            .split_once(" expended charges")
            .or_else(|| recovery.split_once(" charges"))?;
        if formula.trim() == "all" {
            return Some((0, 0));
        }
        let (die, bonus) = match formula.split_once('+') {
            Some((die, bonus)) => (die.trim(), bonus.trim().parse::<u32>().ok()?),
            None => (formula.trim(), 0),
        };
        let sides: u32 = die.strip_prefix("1d")?.parse().ok()?;
        (sides > 1 && sides.checked_add(bonus).is_some()).then_some((sides, bonus))
    })
}

fn attunement(definition: Option<&ContentDefinition>) -> Option<String> {
    let marker = definition?
        .element
        .children_named("setters")
        .flat_map(|setters| setters.children_named("set"))
        .find(|set| {
            attr(set, "name") == Some("attunement")
                && plain_text(&set.children)
                    .trim()
                    .eq_ignore_ascii_case("true")
        })?;
    Some(
        match attr(marker, "addition").filter(|value| !value.trim().is_empty()) {
            Some(addition) => format!("Requires attunement {addition}"),
            None => "Requires attunement".into(),
        },
    )
}

fn words(text: &str) -> Vec<&str> {
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect()
}
