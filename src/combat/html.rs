use std::fmt::Write;

use crate::aurora::{ABILITIES, CharacterProfile, ContentNode, KeyStats, ProfileSection};

use super::{ActionGroup, CombatOption, CombatSheet, ConsumableAmount, OptionKind};

/// Renders a standalone preview without a network connection or client-side dependencies.
pub fn render_html(sheet: &CombatSheet) -> String {
    render_html_with_profile(sheet, "")
}

/// Renders a preview with a stable key for the character's browser preferences.
pub fn render_html_with_profile(sheet: &CombatSheet, profile_key: &str) -> String {
    let mut html = String::from(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <title>Combat sheet</title><style>",
    );
    html.push_str(include_str!("sheet.css"));
    html.push_str("</style></head><body data-profile=\"");
    escape(&mut html, profile_key);
    html.push_str("\"><header class=\"command-bar\"><div class=\"brand\"><span class=\"brand-mark\" aria-hidden=\"true\">A</span><div><strong>Aurora</strong><small>Combat Tracker</small></div></div>\
        <nav class=\"command-nav\" aria-label=\"Tracker\"><a href=\"#combat\" id=\"combat-nav\" aria-current=\"page\">Combat</a><button type=\"button\" id=\"character-nav\">Character</button><button type=\"button\" id=\"companions-nav\">Companions</button><button data-reference=\"Inventory\">Inventory</button><button data-reference=\"Journal\">Journal</button><button data-reference=\"Notes\">Notes</button></nav>\
        <p id=\"encounter-status\" class=\"focus-feedback\" role=\"status\"></p><button type=\"button\" class=\"layout-trigger\" data-dialog=\"layout-dialog\">Layout</button></header><main class=\"dashboard\">");
    render_companions(&mut html, sheet);
    html.push_str("<section class=\"overview\" aria-label=\"Character overview\"><div class=\"identity\"><span class=\"identity-mark\" aria-hidden=\"true\">");
    let name = sheet.character_name.as_deref().unwrap_or("Character");
    let initial = name
        .chars()
        .next()
        .unwrap_or('C')
        .to_uppercase()
        .to_string();
    escape(&mut html, &initial);
    html.push_str("</span><div><h1>");
    escape(&mut html, name);
    html.push_str("</h1>");
    let identity = ["Level", "Class", "Archetype"]
        .into_iter()
        .filter_map(|label| {
            sheet
                .profile
                .fields
                .iter()
                .find(|field| field.label == label)
                .map(|field| {
                    if label == "Level" {
                        format!("Lvl {}", field.value)
                    } else {
                        field.value.clone()
                    }
                })
        })
        .collect::<Vec<_>>()
        .join(" · ");
    if !identity.is_empty() {
        html.push_str("<p>");
        escape(&mut html, &identity);
        html.push_str("</p>");
    }
    html.push_str("<div id=\"owner-effects\" class=\"status-chips\" role=\"group\" aria-label=\"Character effects\" hidden></div></div></div>");
    render_stats(&mut html, &sheet.profile.stats);
    html.push_str(include_str!("concentration.html"));
    render_abilities(&mut html, &sheet.profile.stats);
    html.push_str("<section class=\"resource-strip\" aria-labelledby=\"resource-heading\"><h2 id=\"resource-heading\">Resources</h2><ul id=\"encounter-resources\"></ul><button type=\"button\" class=\"quiet-button\" data-dialog=\"resource-settings\">Manage resources</button></section></section>");
    html.push_str("<section class=\"combat-workspace\" id=\"combat\" aria-labelledby=\"options-heading\"><div class=\"workspace-heading\"><h2 id=\"options-heading\">Combat options</h2>\
        <div class=\"workspace-tools\"><button type=\"button\" id=\"open-companion-sidebar\" class=\"quiet-button\" aria-controls=\"companion-roster-content\">Add companion</button><label class=\"option-search\"><span class=\"visually-hidden\">Search combat options</span><input type=\"search\" id=\"option-search\" placeholder=\"Search options\"></label><button type=\"button\" id=\"toggle-inspector\" aria-controls=\"option-inspector\" aria-expanded=\"true\">Hide details</button></div></div>");
    html.push_str(include_str!("quick-actions.html"));
    html.push_str(
        "<nav class=\"action-tabs\" aria-label=\"Combat options\"><span id=\"group-navigation\">",
    );
    for group in &sheet.groups {
        if group.action != ActionGroup::Other || !group.options.is_empty() {
            write!(
                html,
                "<a href=\"#{}\" data-nav=\"{}\">{}</a>",
                anchor(group.action),
                anchor(group.action),
                group.action.label()
            )
            .unwrap();
        }
    }
    html.push_str("</span><a href=\"#all-options\" data-filter=\"all\">All</a><a href=\"#all-options\" data-filter=\"traits\">Traits</a><a href=\"#pinned\" id=\"pinned-link\" data-filter=\"pinned\">Favorites</a><label class=\"show-unprepared\"><input type=\"checkbox\" id=\"show-unprepared\"> Show unprepared</label></nav>\
        <div class=\"combat-columns\"><div class=\"option-list\" id=\"all-options\">\
        <section id=\"bonus-followups\" hidden><h3>Active bonus actions</h3><div id=\"bonus-followup-list\"></div></section>\
        <section id=\"pinned\" aria-labelledby=\"pinned-heading\" hidden><h2 id=\"pinned-heading\" class=\"visually-hidden\">Pinned</h2><div id=\"pinned-cards\"></div></section>");
    html.push_str("<div id=\"action-groups\">");
    for group in &sheet.groups {
        if group.action == ActionGroup::Other && group.options.is_empty() {
            continue;
        }
        let id = anchor(group.action);
        write!(
            html,
            "<section id=\"{id}\" aria-labelledby=\"{id}-heading\" data-group><h2 id=\"{id}-heading\">{}</h2>",
            group.action.label()
        )
        .unwrap();
        if group.options.is_empty() {
            html.push_str("<p class=\"empty\">No options in this group.</p>");
        }
        if group.action == ActionGroup::Other {
            html.push_str("<p class=\"empty\">Options with another casting time or no identified activation.</p>");
        }
        for option in &group.options {
            start_card(&mut html, Some("option-row"), option.pin_key.as_deref());
            render_option_row(&mut html, option);
            if option.pin_key.is_some() {
                pin_button(&mut html, &option.name);
            }
            html.push_str("<div class=\"option-body\"");
            if let Some(prepared) = option.preparation {
                write!(html, " data-prepared=\"{prepared}\"").unwrap();
            }
            if option.kind == super::OptionKind::Feature
                && let Some(key) = &option.pin_key
            {
                html.push_str(" data-feature=\"");
                escape(&mut html, key);
                html.push('"');
            }
            write!(
                html,
                "><p class=\"kind\" data-kind=\"{}\">{} <span>· {}</span></p>",
                option.kind.label(),
                option.kind.label(),
                group.action.label()
            )
            .unwrap();
            if !option.details.is_empty() {
                html.push_str("<dl class=\"option-facts\">");
                for detail in &option.details {
                    write!(html, "<div><dt>{}</dt><dd>", detail.label).unwrap();
                    escape(&mut html, &detail.value);
                    html.push_str("</dd></div>");
                }
                html.push_str("</dl>");
            }
            if let Some(spell) = &option.concentration {
                html.push_str("<div class=\"spell-concentration\" data-focus-spell=\"");
                escape(&mut html, &spell.name);
                if option.heat_metal {
                    html.push_str("\" data-repeat-bonus=\"heat-metal");
                }
                html.push_str("\" data-duration-label=\"");
                escape(&mut html, spell.duration.as_deref().unwrap_or(""));
                html.push('"');
                if let Some(seconds) = spell.duration_seconds {
                    write!(html, " data-duration-seconds=\"{seconds}\"").unwrap();
                }
                if option.guidance {
                    html.push_str(" data-guidance");
                }
                html.push_str("></div>");
            }
            if !option.description.is_empty() {
                html.push_str(
                    "<details><summary>Full description</summary><div class=\"description\">",
                );
                render_description(&mut html, &option.description);
                html.push_str("</div></details>");
            }
            if option.kind == OptionKind::Feature {
                html.push_str(
                    "<button type=\"button\" data-track-feature>Track uses or effect</button>",
                );
            }
            html.push_str("</div></article>");
        }
        html.push_str("</section>");
    }
    html.push_str("</div><p id=\"no-groups\" class=\"empty\" hidden>All action sections are hidden. Use Layout to show them again.</p><p id=\"no-options\" class=\"empty\" hidden>No matching options.</p>\
        </div><div id=\"inspector-divider\" role=\"separator\" aria-label=\"Resize action list\" aria-orientation=\"vertical\" aria-controls=\"all-options\" tabindex=\"0\"></div><aside class=\"option-inspector\" id=\"option-inspector\" aria-label=\"Selected option\"><p class=\"empty\">Select an option to read its details.</p></aside></div></section>\
        <aside class=\"combat-sidebar\" id=\"effect-home\" aria-label=\"Encounter and active effects\">");
    render_encounter(&mut html, sheet);
    html.push_str("<div class=\"sidebar-reference\">");
    html.push_str(include_str!("effects.html"));
    html.push_str(include_str!("playbook.html"));
    html.push_str("<div id=\"imported-infusions\" hidden>");
    for (id, name) in &sheet.infusions {
        html.push_str("<span data-infusion=\"");
        escape(&mut html, id);
        html.push_str("\">");
        escape(&mut html, name);
        html.push_str("</span>");
    }
    html.push_str("</div>");
    html.push_str("</div></aside>");
    render_rolls(&mut html, sheet);
    html.push_str("<dialog id=\"layout-dialog\" aria-labelledby=\"layout-dialog-title\"><div class=\"dialog-heading\"><h2 id=\"layout-dialog-title\">Layout</h2><form method=\"dialog\"><button>Close</button></form></div>");
    render_layout(&mut html, sheet);
    html.push_str("<p><label><input type=\"checkbox\" id=\"guidance-without-concentration\"> Guidance does not require concentration at my table</label></p><button type=\"button\" data-dialog=\"encounter-settings\">Optional initiative settings</button>");
    html.push_str(
        "</dialog><section class=\"sheet-page\" id=\"character-dialog\" hidden><h1>Character</h1>",
    );
    render_full_sheet(&mut html, &sheet.profile);
    html.push_str("</section><section class=\"sheet-page\" id=\"reference-dialog\" hidden><h1 id=\"reference-title\"></h1><div id=\"reference-content\"></div></section></main><script>");
    html.push_str(include_str!("preferences.js"));
    html.push_str(include_str!("encounter.js"));
    html.push_str(include_str!("companions.js"));
    html.push_str(include_str!("turns.js"));
    html.push_str(include_str!("effects.js"));
    html.push_str(include_str!("consumables.js"));
    html.push_str(include_str!("concentration.js"));
    html.push_str(include_str!("playbook.js"));
    html.push_str(include_str!("quick-actions.js"));
    html.push_str(include_str!("dashboard.js"));
    html.push_str("</script></body></html>");
    html
}

fn render_encounter(html: &mut String, sheet: &CombatSheet) {
    html.push_str(include_str!("turns.html"));
    html.push_str("<div id=\"encounter-baseline\" data-owner=\"");
    escape(html, sheet.character_name.as_deref().unwrap_or("Owner"));
    html.push_str("\" hidden>");
    for resource in &sheet.resources {
        html.push_str("<span data-resource=\"");
        escape(html, &resource.key);
        write!(
            html,
            "\" data-capacity=\"{}\" data-recovery=\"{}\">",
            resource.capacity, resource.recovery
        )
        .unwrap();
        escape(html, &resource.name);
        html.push_str("</span>");
    }
    html.push_str("</div>");
}

fn render_companions(html: &mut String, sheet: &CombatSheet) {
    html.push_str(include_str!("companions.html"));
    html.push_str("<div id=\"companion-templates\" hidden>");
    for template in &sheet.companion_templates {
        companion_data(
            html,
            "data-companion-template",
            &template.id,
            &template.details,
            None,
        );
    }
    for card in &sheet.companions.cards {
        let id = card
            .template_id
            .clone()
            .unwrap_or_else(|| format!("card:{}", card.id));
        companion_data(html, "data-companion-seed", &id, &card.details, Some(card));
    }
    html.push_str("</div>");
}

fn companion_data(
    html: &mut String,
    marker: &str,
    id: &str,
    details: &crate::companion::CompanionDetails,
    card: Option<&crate::companion::CompanionCard>,
) {
    write!(html, "<div {marker}=\"").unwrap();
    escape(html, id);
    html.push('"');
    let hp = details.max_hp.map(|value| value.to_string());
    let rounds = card
        .map_or_else(
            || {
                crate::concentration::parse_duration(&details.duration)
                    .map(|seconds| seconds.div_ceil(6))
            },
            |card| card.remaining_rounds,
        )
        .map(|value| value.to_string());
    if let Some(card) = card {
        let current = card
            .current_hp
            .map(|value| value.to_string())
            .unwrap_or_default();
        write!(html, " data-current-hp=\"{current}\"").unwrap();
        if let crate::companion::CompanionTurn::Separate(score) = card.turn {
            write!(html, " data-turn-score=\"{score}\"").unwrap();
        }
    }
    for (key, value) in [
        ("name", details.name.as_str()),
        ("kind", &details.kind),
        ("armor", &details.armor_class),
        ("speed", &details.speed),
        ("stats", &details.stats),
        ("max-hp", hp.as_deref().unwrap_or("")),
        ("attacks", &details.attacks),
        ("abilities", &details.abilities),
        ("command", &details.command),
        ("duration", &details.duration),
        ("rounds", rounds.as_deref().unwrap_or("")),
    ] {
        write!(html, " data-{key}=\"").unwrap();
        escape(html, value);
        html.push('"');
    }
    html.push_str("></div>");
}

fn render_option_row(html: &mut String, option: &CombatOption) {
    html.push_str("<h3 class=\"option-name\"><button type=\"button\" class=\"pick-option\" data-inspect aria-expanded=\"false\"><span class=\"option-title\">");
    escape(html, &option.name);
    html.push_str("</span><span class=\"option-badges\">");
    match option.spell_level {
        Some(0) => html.push_str("<span class=\"spell-level\">Cantrip</span>"),
        Some(level) => write!(html, "<span class=\"spell-level\">Level {level}</span>").unwrap(),
        None if option.kind == OptionKind::Spell => {
            html.push_str("<span class=\"spell-level\">Level unknown</span>");
        }
        None => {}
    }
    if option.concentration.is_some() {
        let guidance = if option.guidance {
            " data-guidance"
        } else {
            ""
        };
        write!(
            html,
            "<span class=\"option-badge focus-badge\"{guidance}>Concentration</span>"
        )
        .unwrap();
    }
    if option.ritual {
        html.push_str("<span class=\"option-badge\">Ritual</span>");
    }
    let detail = |label| {
        option
            .details
            .iter()
            .find(|detail| detail.label == label)
            .map(|detail| detail.value.as_str())
    };
    if let Some(consumable) = &option.consumable {
        html.push_str("<span class=\"option-badge row-quantity\" data-stack-count=\"");
        escape(html, &consumable.key);
        html.push_str("\">");
        if let Some(amount) = consumable.remaining {
            write!(html, "{amount} left").unwrap();
        } else {
            html.push_str("Qty unknown");
        }
        html.push_str("</span>");
    } else if let Some(cost) = detail("Cost").or_else(|| detail("Uses")) {
        html.push_str("<span class=\"option-badge\">");
        escape(html, cost);
        html.push_str("</span>");
    }
    html.push_str(
        "<span class=\"option-badge unavailable-badge\" data-option-badge hidden></span>",
    );
    html.push_str("</span><span class=\"option-meta option-range\">");
    escape(html, detail("Range").unwrap_or_default());
    html.push_str("</span><span class=\"option-meta option-roll\">");
    let roll = detail("Attack roll")
        .map(str::to_owned)
        .or_else(|| detail("Save DC").map(|value| format!("DC {value}")));
    let damage = detail("Damage").or_else(|| detail("Dice in description"));
    for (index, value) in roll.as_deref().into_iter().chain(damage).enumerate() {
        if index != 0 {
            html.push_str(" · ");
        }
        escape(html, value);
    }
    html.push_str("</span></button></h3><div class=\"option-execute\">");
    if let Some(consumable) = &option.consumable {
        render_consumable(html, consumable, &option.name, option.kind);
    } else {
        match option.kind {
            OptionKind::Spell => {
                html.push_str("<button type=\"button\" data-cast-spell aria-label=\"Cast ");
                escape(html, &option.name);
                html.push('"');
                if let Some(level) = option.spell_level {
                    write!(html, " data-cast-level=\"{level}\"").unwrap();
                }
                if option.ritual {
                    html.push_str(" data-ritual-cast");
                }
                html.push_str(">Cast</button>");
            }
            OptionKind::Attack => {
                html.push_str("<button type=\"button\" data-record-attack=\"");
                escape(html, &option.name);
                html.push_str("\" aria-label=\"Attack with ");
                escape(html, &option.name);
                html.push_str("\">Attack</button>");
            }
            OptionKind::Feature => {
                html.push_str("<button type=\"button\" data-feature-use hidden>Activate</button>")
            }
            _ => {}
        }
    }
    html.push_str("<p class=\"option-availability\" data-option-availability hidden></p></div>");
}

fn render_consumable(
    html: &mut String,
    consumable: &ConsumableAmount,
    name: &str,
    kind: OptionKind,
) {
    html.push_str("<div class=\"consumable\" data-consumable=\"");
    escape(html, &consumable.key);
    html.push('"');
    if let Some(amount) = consumable.remaining {
        write!(html, " data-amount=\"{amount}\"").unwrap();
    }
    html.push_str("><span class=\"consumable-quantity\">Quantity <strong data-remaining>");
    if let Some(amount) = consumable.remaining {
        write!(html, "{amount}").unwrap();
    } else {
        html.push_str("Unavailable");
    }
    html.push_str("</strong></span><button type=\"button\" data-use=\"");
    escape(html, name);
    html.push_str("\" aria-label=\"Use ");
    escape(html, name);
    html.push('"');
    if !consumable.remaining.is_some_and(|amount| amount > 0) {
        html.push_str(" disabled");
    }
    let label = if kind == OptionKind::Scroll {
        "Use scroll"
    } else {
        "Use item"
    };
    write!(html, ">{label}</button></div>").unwrap();
}

fn render_stats(html: &mut String, stats: &KeyStats) {
    html.push_str("<section id=\"key-stats\" aria-labelledby=\"stats-heading\"><h2 id=\"stats-heading\" class=\"visually-hidden\">Key stats</h2><div class=\"stat-grid\">");
    let hp = stats.max_hp.map(|value| format!("{value} max"));
    let armor = stats.armor_class.map(|value| value.to_string());
    for (key, label, value) in [
        ("hp", "HP", hp.as_deref()),
        ("ac", "AC", armor.as_deref()),
        ("speed", "Speed", stats.speed.as_deref()),
    ] {
        let class = if key == "hp" {
            "stat-card hp-card"
        } else {
            "stat-card"
        };
        start_card(html, Some(class), Some(&format!("stat:{key}")));
        write!(
            html,
            "<h3>{label}</h3><p class=\"stat-number\" data-stat=\"{key}\">"
        )
        .unwrap();
        escape(
            html,
            value.unwrap_or(if key == "ac" { "—" } else { "Unavailable" }),
        );
        html.push_str("</p>");
        if key == "hp" {
            html.push_str("<span class=\"temp-hp\" data-temp-hp hidden></span><div class=\"health-actions\"><button type=\"button\" data-dialog=\"damage-dialog\" aria-label=\"Record damage\">Damage</button><button type=\"button\" data-dialog=\"hp-settings\">Set HP</button><button type=\"button\" data-dialog=\"rest-picker\">Rest</button></div>");
        }
        pin_button(html, label);
        html.push_str("</article>");
    }
    html.push_str("</div></section>");
}

fn render_abilities(html: &mut String, stats: &KeyStats) {
    start_card(html, Some("stat-card saves-card"), Some("stat:saves"));
    html.push_str("<h3 class=\"visually-hidden\">Ability rolls</h3>");
    html.push_str("<div class=\"ability-tiles\">");
    let signed =
        |value: Option<i32>| value.map_or_else(|| "—".into(), |value| format!("{value:+}"));
    for (index, (ability, key)) in ABILITIES.into_iter().zip(SAVE_KEYS).enumerate() {
        let modifier = signed(stats.modifiers[index]);
        let check = signed(stats.checks[index]);
        let save = signed(stats.saves[index]);
        writeln!(html, "<button class=\"ability-tile\" type=\"button\" data-ability=\"{ability}\" data-check=\"{check}\" aria-haspopup=\"dialog\" aria-label=\"{ability} modifier {modifier}, view check and saving throw\"><span>{}</span><strong>{modifier}</strong><span hidden data-stat=\"{key}\">{save}</span></button>", key.to_uppercase()).unwrap();
    }
    html.push_str("</div><button class=\"quiet-button\" type=\"button\" data-dialog=\"roll-dialog\">Attack &amp; spell bonuses</button>");
    pin_button(html, "Saving throws");
    html.push_str("</article>");
}

fn render_rolls(html: &mut String, sheet: &CombatSheet) {
    html.push_str("<dialog id=\"ability-dialog\" aria-labelledby=\"ability-title\"><div class=\"dialog-heading\"><h2 id=\"ability-title\">Ability rolls</h2><form method=\"dialog\"><button>Close</button></form></div><dl class=\"ability-details\"><div><dt>Ability modifier</dt><dd id=\"ability-modifier\"></dd></div><div><dt>Ability check</dt><dd id=\"ability-check\"></dd></div><div><dt>Saving throw</dt><dd id=\"ability-save\"></dd></div></dl></dialog>");
    if let Some(casting) = sheet.casting_rolls.iter().find(|casting| {
        casting
            .name
            .as_deref()
            .is_some_and(|name| name.eq_ignore_ascii_case("Artificer"))
            || casting
                .source_id
                .as_deref()
                .is_some_and(|id| id.ends_with("_CLASS_ARTIFICER"))
    }) {
        html.push_str("<span id=\"cannon-rolls\" hidden");
        if let Some(attack) = casting.attack_bonus {
            write!(html, " data-attack=\"{attack:+}\"").unwrap();
        }
        if let Some(dc) = casting.save_dc {
            write!(html, " data-dc=\"{dc}\"").unwrap();
        }
        html.push_str("></span>");
    }
    html.push_str("<dialog id=\"roll-dialog\" aria-labelledby=\"roll-heading\"><div class=\"dialog-heading\"><h2 id=\"roll-heading\">Attack and spell bonuses</h2><form method=\"dialog\"><button>Close</button></form></div><dl class=\"roll-details\">");
    for casting in &sheet.casting_rolls {
        html.push_str("<dt>");
        escape(html, casting.name.as_deref().unwrap_or("Spellcasting"));
        html.push_str("</dt><dd>");
        let attack = casting
            .attack_bonus
            .map(|value| format!("{value:+}"))
            .unwrap_or_else(|| "—".into());
        let dc = casting
            .save_dc
            .map(|value| value.to_string())
            .unwrap_or_else(|| "—".into());
        write!(html, "Spell attack {attack} · Save DC {dc}</dd>").unwrap();
    }
    for option in sheet
        .groups
        .iter()
        .flat_map(|group| &group.options)
        .filter(|option| option.kind == super::OptionKind::Attack)
    {
        if let Some(roll) = option
            .details
            .iter()
            .find(|detail| detail.label == "Attack roll")
        {
            html.push_str("<dt>");
            escape(html, &option.name);
            html.push_str("</dt><dd>");
            escape(html, &roll.value);
            html.push_str("</dd>");
        }
    }
    html.push_str("</dl></dialog>");
}

const SAVE_KEYS: [&str; 6] = ["str", "dex", "con", "int", "wis", "cha"];

fn render_layout(html: &mut String, sheet: &CombatSheet) {
    html.push_str("<details id=\"sheet-layout\" class=\"panel\" open><summary>Combat sections and stats</summary><div class=\"panel-body\"><ul id=\"section-settings\">");
    for group in &sheet.groups {
        if group.action == ActionGroup::Other && group.options.is_empty() {
            continue;
        }
        let id = anchor(group.action);
        let label = group.action.label();
        write!(html, "<li data-setting=\"{id}\"><label><input type=\"checkbox\" checked data-visible> {label}</label>\
            <button type=\"button\" data-move=\"-1\" aria-label=\"Move {label} earlier\">↑</button>\
            <button type=\"button\" data-move=\"1\" aria-label=\"Move {label} later\">↓</button></li>").unwrap();
    }
    html.push_str("</ul><form id=\"stat-settings\"><h2>Stat overrides</h2><p>Leave a field blank to use the Aurora value when available.</p><div class=\"stat-inputs\">");
    for (key, label) in [("hp", "HP"), ("ac", "Armor Class"), ("speed", "Speed")]
        .into_iter()
        .chain(SAVE_KEYS.into_iter().zip(ABILITIES))
    {
        write!(
            html,
            "<label>{label}<input type=\"text\" name=\"{key}\" maxlength=\"80\"></label>"
        )
        .unwrap();
    }
    html.push_str("</div><button type=\"submit\">Save stat overrides</button></form><p id=\"layout-status\" role=\"status\"></p></div></details>");
}

fn render_full_sheet(html: &mut String, profile: &CharacterProfile) {
    html.push_str("<details id=\"full-sheet\" class=\"panel\" open><summary>Full sheet</summary><div class=\"panel-body profile-fields\">");
    for section in ProfileSection::ALL {
        let mut fields = profile
            .fields
            .iter()
            .filter(|field| field.section == section)
            .peekable();
        if fields.peek().is_none() {
            continue;
        }
        write!(html, "<section><h2>{}</h2><dl>", section.label()).unwrap();
        for field in fields {
            write!(html, "<div><dt>{}</dt><dd>", field.label).unwrap();
            escape(html, &field.value);
            html.push_str("</dd></div>");
        }
        html.push_str("</dl></section>");
    }
    if profile.fields.is_empty() {
        html.push_str("<p class=\"empty\">This save has no full-sheet details.</p>");
    }
    html.push_str("</div></details>");
}

fn start_card(html: &mut String, class: Option<&str>, key: Option<&str>) {
    html.push_str("<article");
    if let Some(class) = class {
        write!(html, " class=\"{class}\"").unwrap();
    }
    if let Some(key) = key {
        html.push_str(" data-pin=\"");
        escape(html, key);
        html.push('"');
    }
    html.push('>');
}

fn pin_button(html: &mut String, label: &str) {
    html.push_str("<button type=\"button\" class=\"pin-button\" data-pin-toggle=\"");
    escape(html, label);
    html.push_str("\" aria-label=\"Pin ");
    escape(html, label);
    html.push_str("\" aria-pressed=\"false\">Pin</button>");
}

fn anchor(action: ActionGroup) -> &'static str {
    match action {
        ActionGroup::Action => "action",
        ActionGroup::BonusAction => "bonus-action",
        ActionGroup::Reaction => "reaction",
        ActionGroup::Other => "other-options",
    }
}

fn render_description(html: &mut String, nodes: &[ContentNode]) {
    for node in nodes {
        match node {
            ContentNode::Text(text) => escape(html, text),
            ContentNode::Element(element) => match element.tag.as_str() {
                "br" | "hr" => write!(html, "<{}>", element.tag).unwrap(),
                "p" | "div" | "span" | "em" | "i" | "b" | "strong" | "ul" | "ol" | "li"
                | "table" | "caption" | "thead" | "tbody" | "tfoot" | "tr" | "th" | "td"
                | "sub" | "sup" => {
                    write!(html, "<{}>", element.tag).unwrap();
                    render_description(html, &element.children);
                    write!(html, "</{}>", element.tag).unwrap();
                }
                _ => render_description(html, &element.children),
            },
        }
    }
}

fn escape(html: &mut String, text: &str) {
    for ch in text.chars() {
        match ch {
            '&' => html.push_str("&amp;"),
            '<' => html.push_str("&lt;"),
            '>' => html.push_str("&gt;"),
            '"' => html.push_str("&quot;"),
            '\'' => html.push_str("&#39;"),
            _ => html.push(ch),
        }
    }
}
