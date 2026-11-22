use std::{collections::BTreeMap, error::Error, fmt};

use crate::aurora::{ContentDefinition, ContentNode, ImportedCharacter, ImportedItem};

#[derive(Debug, PartialEq, Eq)]
pub enum ConsumableUseError {
    UnknownStack,
    QuantityUnavailable,
    Depleted,
}

impl fmt::Display for ConsumableUseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::UnknownStack => "this consumable stack is no longer in the character's inventory",
            Self::QuantityUnavailable => "this consumable stack has no usable quantity",
            Self::Depleted => "this consumable stack is depleted",
        })
    }
}

impl Error for ConsumableUseError {}

#[derive(Default)]
pub(crate) struct ConsumableUses {
    spent: BTreeMap<String, u32>,
}

impl ConsumableUses {
    pub(crate) fn remaining(&self, key: &str, amount: Option<u32>) -> Option<u32> {
        Some(amount?.saturating_sub(self.spent.get(key).copied().unwrap_or(0)))
    }

    pub(crate) fn use_one(
        &mut self,
        character: &ImportedCharacter,
        key: &str,
    ) -> Result<u32, ConsumableUseError> {
        let amount = consumable_amounts(character)
            .remove(key)
            .ok_or(ConsumableUseError::UnknownStack)?;
        let remaining = self
            .remaining(key, amount)
            .ok_or(ConsumableUseError::QuantityUnavailable)?;
        if remaining == 0 {
            return Err(ConsumableUseError::Depleted);
        }
        *self.spent.entry(key.to_owned()).or_default() += 1;
        Ok(remaining - 1)
    }
}

pub(crate) fn consumable_amounts(character: &ImportedCharacter) -> BTreeMap<String, Option<u32>> {
    let mut amounts: BTreeMap<String, Option<u32>> = BTreeMap::new();
    for item in &character.equipment {
        if let Some(key) = consumable_key(item) {
            let quantity = item
                .inventory
                .as_ref()
                .and_then(|inventory| inventory.quantity);
            // Saves without an instance identifier share one stack per content ID.
            amounts
                .entry(key)
                .and_modify(|amount| {
                    *amount = amount
                        .zip(quantity)
                        .and_then(|(left, right)| left.checked_add(right));
                })
                .or_insert(quantity);
        }
    }
    amounts
}

pub(crate) fn consumable_key(item: &ImportedItem) -> Option<String> {
    let inventory = item.inventory.as_ref()?;
    let id = &item.content_id;
    let definition = item.definition.as_ref();
    let is_consumable = is_scroll(id, definition)
        || has_setter(definition, "consumable", &["true"])
        || has_setter(definition, "type", &["Potion", "Consumable", "Ammunition"])
        || has_setter(
            definition,
            "category",
            &["Potions", "Consumables", "Ammunition"],
        );
    if !is_consumable {
        return None;
    }
    Some(match &inventory.identifier {
        Some(identifier) => format!("stack:{}:{id}:{identifier}", id.len()),
        None => format!("content:{id}"),
    })
}

pub(crate) fn is_scroll(id: &str, definition: Option<&ContentDefinition>) -> bool {
    id.contains("_SPELL_SCROLL_")
        || has_setter(definition, "type", &["Scroll"])
        || has_setter(definition, "category", &["Scrolls"])
}

fn has_setter(definition: Option<&ContentDefinition>, name: &str, values: &[&str]) -> bool {
    definition.into_iter()
        .flat_map(|definition| definition.element.children_named("setters"))
        .flat_map(|setters| setters.children_named("set"))
        .filter(|set| set.attributes.get("name").is_some_and(|key| key.eq_ignore_ascii_case(name)))
        .any(|set| set.children.iter().any(|child| {
            matches!(child, ContentNode::Text(value) if values.iter().any(|expected| value.trim().eq_ignore_ascii_case(expected)))
        }))
}
