use std::collections::{HashSet, VecDeque};

use crate::aurora::{
    CharacterProfile, ContentDefinition, ContentElement, ContentNode, ImportedCharacter,
    SpellcastingStats, is_feature_kind,
};
use crate::concentration::ConcentrationSpell;
use crate::inventory::{ConsumableUses, consumable_amounts, consumable_key, is_scroll};

mod html;

pub use html::{render_html, render_html_with_profile};

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
    pub pin_key: Option<String>,
    pub kind: OptionKind,
    pub details: Vec<CombatDetail>,
    pub description: Vec<ContentNode>,
    pub consumable: Option<ConsumableAmount>,
    pub concentration: Option<ConcentrationSpell>,
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
    pub profile: CharacterProfile,
    pub groups: [CombatGroup; 4],
}

impl CombatSheet {
    pub fn from_character(character: &ImportedCharacter) -> Self {
        Self::with_consumable_uses(character, &ConsumableUses::default())
    }

    pub(crate) fn with_consumable_uses(
        character: &ImportedCharacter,
        uses: &ConsumableUses,
    ) -> Self {
        let mut sheet = Self {
            character_name: character.name.clone(),
            profile: character.profile.clone(),
            groups: ActionGroup::ALL.map(|action| CombatGroup {
                action,
                options: Vec::new(),
            }),
        };
        for attack in &character.attacks {
            let mut option = CombatOption::new(OptionKind::Attack, &attack.name);
            option.pin_key = attack
                .identifier
                .as_ref()
                .map(|id| format!("saved-attack:{id}"));
            option.detail("Range", attack.range.as_deref());
            option.detail("Attack roll", attack.attack.as_deref());
            option.detail("Damage", attack.damage.as_deref());
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
                    kind: OptionKind::Spell,
                    consumable: None,
                },
            );
        }
        let mut amounts = consumable_amounts(character);
        for item in &character.equipment {
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
                    kind,
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
                    kind: OptionKind::Attack,
                    consumable: None,
                },
            );
        }
        sheet.add_features(character);
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
                    // Level/prerequisite-dependent grants need a saved selection.
                    if attributes
                        .keys()
                        .any(|key| !matches!(key.as_str(), "id" | "type"))
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
                    kind: OptionKind::Feature,
                    consumable: None,
                },
            );
        }
    }

    fn add_definition(&mut self, character: &ImportedCharacter, source: DefinitionOption<'_>) {
        let DefinitionOption {
            id,
            name,
            definition,
            linked_spell,
            spellcasting,
            kind,
            consumable,
        } = source;
        let name = name
            .or_else(|| definition.and_then(|value| value.name.as_deref()))
            .unwrap_or(id);
        let mut option = CombatOption::new(kind, name);
        option.consumable = consumable;
        option.pin_key = Some(
            match spellcasting.and_then(|casting| casting.source_id.as_deref()) {
                Some(caster) => format!("{}:{id}:{caster}", kind.label()),
                None => format!("{}:{id}", kind.label()),
            },
        );
        let mechanics = linked_spell.or(definition);
        let time = setter(mechanics, "time");
        if matches!(kind, OptionKind::Spell | OptionKind::Scroll) {
            let duration = setter(mechanics, "duration");
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
        option.detail("Casting time", time.as_deref());
        option.detail("Range", setter(mechanics, "range"));
        let damage = setter(mechanics, "damage");
        option.detail("Damage", damage.as_deref());

        option.description = description(character, id, definition);
        if let Some(spell) = linked_spell {
            let spell_id = attr(&spell.element, "id").unwrap_or(id);
            option
                .description
                .extend(description(character, spell_id, Some(spell)));
        }
        let text = plain_text(&option.description);
        let lower = text.to_ascii_lowercase();
        if damage.is_none() {
            let dice = dice_in(&text);
            if !dice.is_empty() {
                option.detail("Dice in description", Some(dice.join(" · ")));
            }
        }
        let attack = setter(definition, "attackBonus").or_else(|| {
            lower
                .contains("spell attack")
                .then_some(spellcasting?.attack_bonus?)
                .map(|bonus| format!("{bonus:+}"))
        });
        let dc = setter(definition, "saveDC").or_else(|| {
            if !lower.contains("saving throw") {
                return None;
            }
            written_save_dc(&lower).or_else(|| spellcasting?.save_dc.map(|dc| dc.to_string()))
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
                if let Some(level) = setter(definition, "level") {
                    if level == "0" {
                        option.detail("Spell slot", Some("Cantrip"));
                    } else {
                        option.detail(
                            "Spell slot",
                            Some(format!("Level {level} when cast normally")),
                        );
                    }
                }
                option.detail("Material", setter(definition, "materialComponent"));
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

        let fallback = match time.as_deref() {
            Some(time) => ActionGroup::from_label(time),
            None if kind == OptionKind::Attack => Some(ActionGroup::Action),
            None => activation_in(&lower),
        };
        if definition.is_none() && linked_spell.is_none() {
            option.detail("Aurora content", Some("Definition unavailable"));
        }
        for activation in activations(definition, fallback) {
            let mut entry = option.clone();
            entry.detail("Uses", activation.usage);
            entry.detail("Level", activation.level);
            self.push(activation.group, entry);
        }
    }

    fn push(&mut self, action: ActionGroup, option: CombatOption) {
        self.groups[action as usize].options.push(option);
    }
}

struct DefinitionOption<'a> {
    id: &'a str,
    name: Option<&'a str>,
    definition: Option<&'a ContentDefinition>,
    linked_spell: Option<&'a ContentDefinition>,
    spellcasting: Option<&'a SpellcastingStats>,
    kind: OptionKind,
    consumable: Option<ConsumableAmount>,
}

impl CombatOption {
    fn new(kind: OptionKind, name: &str) -> Self {
        Self {
            name: name.to_owned(),
            pin_key: None,
            kind,
            details: Vec::new(),
            description: Vec::new(),
            consumable: None,
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
    let mut charges = tokens.windows(3).filter_map(|words| {
        if !matches!(words[0], "spend" | "spending" | "expend" | "expending")
            || !matches!(words[2], "charge" | "charges")
        {
            return None;
        }
        match words[1] {
            "one" => Some(1),
            "two" => Some(2),
            "three" => Some(3),
            value => value.parse::<u16>().ok(),
        }
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

fn words(text: &str) -> Vec<&str> {
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect()
}
