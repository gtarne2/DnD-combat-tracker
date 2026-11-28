use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Deserializer, Serialize, de};
use uuid::Uuid;

const LEGACY_SCHEMA: u32 = 1;
pub const PACK_SCHEMA: u32 = 2;

fn legacy_schema() -> u32 {
    LEGACY_SCHEMA
}

fn is_legacy_schema(version: &u32) -> bool {
    *version == LEGACY_SCHEMA
}

fn read_schema<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
    let version = u32::deserialize(deserializer)?;
    check_schema(version).map_err(de::Error::custom)?;
    Ok(version)
}

fn check_schema(version: u32) -> Result<(), String> {
    match version {
        LEGACY_SCHEMA | PACK_SCHEMA => Ok(()),
        _ => Err(format!("Unsupported monster pack schema {version}.")),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackInfo {
    pub id: String,
    pub edition: String,
    pub source: String,
    pub attribution: String,
    pub source_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<License>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct License {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pack {
    #[serde(deserialize_with = "read_schema")]
    pub schema_version: u32,
    pub info: PackInfo,
    pub monsters: Vec<Monster>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Defenses {
    pub ac: Option<i32>,
    pub armor: Option<String>,
    pub vulnerabilities: Option<String>,
    pub resistances: Option<String>,
    pub immunities: Option<String>,
    pub condition_immunities: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub conditional_ac: Vec<ConditionalArmor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionalArmor {
    pub ac: Option<i32>,
    pub qualifier: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
/// Shared creature reference data. Encounter instances and player cards own their live state.
pub struct StatBlock {
    pub creature_type: Option<String>,
    pub size: Option<String>,
    pub challenge: Option<String>,
    pub defenses: Defenses,
    pub hp: Option<u32>,
    pub hit_dice: Option<String>,
    pub speed: Option<String>,
    pub abilities: BTreeMap<String, i32>,
    pub saves: BTreeMap<String, i32>,
    pub skills: BTreeMap<String, i32>,
    pub senses: Option<String>,
    pub languages: Option<String>,
    pub notes: Option<String>,
    pub traits: Vec<Action>,
    pub actions: Vec<Action>,
    pub bonus_actions: Vec<Action>,
    pub reactions: Vec<Action>,
    pub legendary_actions: Vec<Action>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<StatDetails>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StatDetails {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sizes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initiative: Option<PrintedInitiative>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proficiency_bonus: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xp: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub challenge_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saves_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gear: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legendary_preamble: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sections: Vec<RuleSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrintedInitiative {
    pub modifier: Option<i32>,
    pub score: Option<i32>,
    pub qualifier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuleSection {
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceLocator {
    pub entry_id: Option<String>,
    pub page: Option<u32>,
    pub section: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Monster {
    pub id: String,
    pub name: String,
    pub stats: StatBlock,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_locator: Option<SourceLocator>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Action {
    pub id: String,
    pub name: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attack_bonus: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reach_ft: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range_ft: Option<Range>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub damage: Vec<Damage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save_dc: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uses: Option<Uses>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recharge: Option<Recharge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub multiattack: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<ActionResolution>,
}

impl Action {
    pub(crate) fn text(id: String, name: String, text: String) -> Self {
        Self {
            id,
            name,
            text,
            attack_bonus: None,
            reach_ft: None,
            range_ft: None,
            damage: vec![],
            save_dc: None,
            uses: None,
            recharge: None,
            multiattack: vec![],
            resolution: None,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActionResolution {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub save: Option<Save>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legendary_cost: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub ability: Ability,
    pub dc: u32,
    pub on_failure: DamageOutcome,
    pub on_success: DamageOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ability {
    Strength,
    Dexterity,
    Constitution,
    Intelligence,
    Wisdom,
    Charisma,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DamageOutcome {
    Full,
    Half,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Range {
    pub normal: u32,
    pub long: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Damage {
    pub damage_type: String,
    pub dice: Option<String>,
    pub average: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Uses {
    pub count: u32,
    pub reset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recharge {
    pub die: u32,
    pub minimum: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    // Older room records and journaled commands have no snapshot version.
    #[serde(
        default = "legacy_schema",
        deserialize_with = "read_schema",
        skip_serializing_if = "is_legacy_schema"
    )]
    pub schema_version: u32,
    pub pack: PackInfo,
    pub revision: Uuid,
    pub monster: Monster,
}

fn label(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 120 && !value.chars().any(char::is_control)
}

fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':'))
}

impl PackInfo {
    fn validate(&self, schema: u32) -> Result<(), String> {
        if !id(&self.id)
            || !label(&self.edition)
            || !label(&self.source)
            || self.attribution.trim().is_empty()
            || self.attribution.len() > 4096
            || self
                .source_version
                .as_deref()
                .is_some_and(|value| !label(value))
        {
            return Err("Check pack ID, edition, source, source version and attribution.".into());
        }
        if let Some(license) = &self.license {
            if schema == LEGACY_SCHEMA {
                return Err("License metadata requires monster pack schema 2.".into());
            }
            if !label(&license.name)
                || license.url.as_ref().is_some_and(|url| {
                    url.trim().is_empty() || url.len() > 2048 || url.chars().any(char::is_control)
                })
            {
                return Err("Check the pack license name and URL.".into());
            }
        }
        Ok(())
    }
}

impl Pack {
    pub fn decode(json: &[u8]) -> Result<Self, String> {
        let pack: Self = serde_json::from_slice(json).map_err(|err| err.to_string())?;
        pack.validate()?;
        Ok(pack)
    }

    pub fn validate(&self) -> Result<(), String> {
        check_schema(self.schema_version)?;
        self.info.validate(self.schema_version)?;
        if self.monsters.is_empty() {
            return Err("A pack needs at least one monster.".into());
        }
        let mut ids = BTreeSet::new();
        for monster in &self.monsters {
            if !ids.insert(&monster.id) {
                return Err(format!("Duplicate monster ID {}.", monster.id));
            }
            monster
                .validate(self.schema_version)
                .map_err(|err| format!("{}: {err}", monster.name))?;
        }
        Ok(())
    }
}

impl Snapshot {
    pub fn validate(&self) -> Result<(), String> {
        check_schema(self.schema_version)?;
        self.pack.validate(self.schema_version)?;
        self.monster.validate(self.schema_version)
    }

    pub fn same_template(&self, other: &Self) -> bool {
        self.pack.id == other.pack.id
            && self.revision == other.revision
            && self.monster.id == other.monster.id
    }
}

impl Monster {
    fn validate(&self, schema: u32) -> Result<(), String> {
        if !id(&self.id) || !label(&self.name) {
            return Err("Enter a monster ID and name.".into());
        }
        if serde_json::to_vec(self)
            .map_err(|err| err.to_string())?
            .len()
            > 128 * 1024
        {
            return Err("The stat block exceeds 128 KiB.".into());
        }
        let lists = [
            &self.stats.traits,
            &self.stats.actions,
            &self.stats.bonus_actions,
            &self.stats.reactions,
            &self.stats.legendary_actions,
        ];
        if schema == LEGACY_SCHEMA
            && (self.source_locator.is_some()
                || self.stats.details.is_some()
                || !self.stats.defenses.conditional_ac.is_empty()
                || lists.into_iter().flatten().any(|a| a.resolution.is_some()))
        {
            return Err(
                "Edition details and action resolution require monster pack schema 2.".into(),
            );
        }
        if self.source_locator.as_ref().is_some_and(|locator| {
            locator.page == Some(0)
                || locator.entry_id.is_none() && locator.page.is_none() && locator.section.is_none()
                || [&locator.entry_id, &locator.section, &locator.source_version]
                    .into_iter()
                    .flatten()
                    .any(|text| text.trim().is_empty())
        }) || self
            .stats
            .defenses
            .conditional_ac
            .iter()
            .any(|armor| armor.qualifier.trim().is_empty())
            || self.stats.details.as_ref().is_some_and(|details| {
                details.sizes.iter().any(|size| !label(size))
                    || details
                        .sections
                        .iter()
                        .any(|section| !label(&section.title) || section.text.trim().is_empty())
            })
        {
            return Err("Check source locator, conditional AC, sizes and rules sections.".into());
        }
        let mut by_id = BTreeMap::new();
        for action in lists.into_iter().flatten() {
            if by_id.insert(action.id.as_str(), action).is_some() {
                return Err(format!("Duplicate rules ID for {}.", action.name));
            }
            action
                .validate(schema)
                .map_err(|error| format!("{}: {error}", action.name))?;
        }
        if lists[..4]
            .iter()
            .flat_map(|list| list.iter())
            .any(|action| {
                action
                    .resolution
                    .as_ref()
                    .and_then(|r| r.legendary_cost)
                    .is_some()
            })
        {
            return Err("A legendary cost belongs on a legendary action.".into());
        }
        validate_strikes(&self.stats.actions, &by_id, schema)
    }
}

impl Action {
    fn validate(&self, schema: u32) -> Result<(), &'static str> {
        if !id(&self.id) || !label(&self.name) || self.text.trim().is_empty() {
            return Err("Check the ID, name and rules text.");
        }
        if self
            .range_ft
            .as_ref()
            .is_some_and(|r| r.long.is_some_and(|n| n < r.normal))
            || self.damage.iter().any(|d| {
                !label(&d.damage_type)
                    || d.average.is_none()
                        && d.dice.as_deref().is_none_or(|dice| dice.trim().is_empty())
                    || schema == PACK_SCHEMA
                        && d.dice.as_deref().is_some_and(|dice| !bounded_dice(dice))
            })
            || self.recharge.as_ref().is_some_and(|r| {
                r.minimum == 0
                    || r.minimum > r.die
                    || schema == PACK_SCHEMA && !(2..=1000).contains(&r.die)
            })
        {
            return Err("Invalid range, damage dice, or recharge.");
        }
        if let Some(resolution) = &self.resolution {
            if resolution.save.as_ref().is_some_and(|save| {
                !(1..=99).contains(&save.dc)
                    || self.save_dc.is_some_and(|dc| dc != save.dc)
                    || self.damage.is_empty()
                        && [&save.on_failure, &save.on_success]
                            .into_iter()
                            .any(|outcome| !matches!(outcome, DamageOutcome::None))
            }) {
                return Err(
                    "A structured save requires a valid DC and damage for full or half outcomes.",
                );
            }
            if resolution.legendary_cost.is_some_and(|cost| cost == 0)
                || resolution
                    .manual_note
                    .as_ref()
                    .is_some_and(|note| note.trim().is_empty())
            {
                return Err("Check the legendary cost and manual resolution note.");
            }
        }
        if schema == PACK_SCHEMA && self.multiattack.len() > 32 {
            return Err("Multiattack supports up to 32 ordered strikes.");
        }
        Ok(())
    }
}

// Damage dice support one bounded term and an optional signed modifier.
fn bounded_dice(text: &str) -> bool {
    let Some((count, rest)) = text.trim().split_once(['d', 'D']) else {
        return false;
    };
    let (sides, modifier) = rest.find(['+', '-']).map_or((rest, None), |p| {
        let (sides, modifier) = rest.split_at(p);
        (sides, Some(&modifier[1..]))
    });
    let within = |value: &str, min: u32, max: u32| {
        let value = value.trim();
        value.bytes().all(|byte| byte.is_ascii_digit())
            && value.parse::<u32>().is_ok_and(|n| (min..=max).contains(&n))
    };
    within(count, 1, 100)
        && within(sides, 2, 1000)
        && modifier.is_none_or(|value| within(value, 0, 10_000))
}

fn validate_strikes<'a>(
    actions: &'a [Action],
    by_id: &BTreeMap<&'a str, &'a Action>,
    schema: u32,
) -> Result<(), String> {
    let action_ids: BTreeSet<_> = actions.iter().map(|action| action.id.as_str()).collect();
    let mut remaining = BTreeMap::new();
    let mut parents = BTreeMap::<_, Vec<_>>::new();
    let mut ready = Vec::new();
    let mut nested = false;
    for (&id, action) in by_id {
        if action.multiattack.is_empty() {
            ready.push(id);
        }
        remaining.insert(id, action.multiattack.len());
        for strike in &action.multiattack {
            let strike = strike.as_str();
            if !action_ids.contains(strike) {
                return Err(format!(
                    "Unresolved multiattack reference in {}.",
                    action.name
                ));
            }
            nested |= !by_id[strike].multiattack.is_empty();
            parents.entry(strike).or_default().push(id);
        }
    }
    let mut visited = 0;
    while let Some(id) = ready.pop() {
        visited += 1;
        for parent in parents.get(id).into_iter().flatten() {
            let count = remaining
                .get_mut(parent)
                .expect("parent is in the same stat block");
            *count -= 1;
            if *count == 0 {
                ready.push(parent);
            }
        }
    }
    if visited != by_id.len() {
        return Err("Cyclic multiattack reference.".into());
    }
    if schema == PACK_SCHEMA && nested {
        return Err("Multiattack strikes must reference individual actions.".into());
    }
    Ok(())
}
