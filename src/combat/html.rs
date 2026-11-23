use std::fmt::Write;

use crate::aurora::{ABILITIES, CharacterProfile, ContentNode, KeyStats, ProfileSection};

use super::{ActionGroup, CombatSheet, ConsumableAmount};

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
        <nav class=\"command-nav\" aria-label=\"Tracker\"><a href=\"#combat\" aria-current=\"page\">Combat</a><button type=\"button\" data-dialog=\"character-dialog\">Character</button><a class=\"compact-nav\" href=\"#encounter\">Initiative</a><a href=\"#effects\">Effects</a><a href=\"#companions\">Companions</a></nav>\
        <button type=\"button\" class=\"layout-trigger\" data-dialog=\"layout-dialog\">Layout</button></header><main class=\"dashboard\">");
    render_encounter(&mut html, sheet);
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
    html.push_str("</div></div>");
    render_stats(&mut html, &sheet.profile.stats);
    html.push_str(include_str!("concentration.html"));
    html.push_str("<section class=\"resource-strip\" aria-labelledby=\"resource-heading\"><h2 id=\"resource-heading\">Resources</h2><ul id=\"encounter-resources\"></ul><button type=\"button\" class=\"quiet-button\" data-dialog=\"encounter-settings\" data-reveal=\"resource-panel\">Manage</button></section></section>");
    html.push_str("<section class=\"combat-workspace\" id=\"combat\" aria-labelledby=\"options-heading\"><div class=\"workspace-heading\"><h2 id=\"options-heading\">Combat options</h2>\
        <label class=\"option-search\"><span class=\"visually-hidden\">Search combat options</span><input type=\"search\" id=\"option-search\" placeholder=\"Search options\"></label></div>\
        <nav class=\"action-tabs\" aria-label=\"Combat options\"><span id=\"group-navigation\">");
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
    html.push_str("</span><a href=\"#all-options\" data-filter=\"all\">All</a><a href=\"#pinned\" id=\"pinned-link\" data-filter=\"pinned\" hidden>Pinned</a></nav>\
        <div class=\"combat-columns\"><div class=\"option-list\" id=\"all-options\">\
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
            html.push_str("<h3 class=\"option-name\"><button type=\"button\" class=\"pick-option\" data-inspect aria-expanded=\"false\"><span class=\"option-title\">");
            escape(&mut html, &option.name);
            html.push_str("</span><span class=\"option-meta\">");
            let summary = option
                .details
                .iter()
                .filter(|detail| {
                    matches!(
                        detail.label,
                        "Attack roll" | "Damage" | "Save DC" | "Range" | "Uses" | "Cost"
                    )
                })
                .take(3)
                .map(|detail| match detail.label {
                    "Save DC" => format!("DC {}", detail.value),
                    _ => detail.value.clone(),
                })
                .collect::<Vec<_>>()
                .join(" · ");
            escape(&mut html, &summary);
            html.push_str("</span>");
            if let Some(consumable) = &option.consumable {
                html.push_str("<span class=\"row-quantity\" data-stack-count=\"");
                escape(&mut html, &consumable.key);
                html.push_str("\">");
                if let Some(amount) = consumable.remaining {
                    write!(html, "{amount} left").unwrap();
                } else {
                    html.push_str("Qty unknown");
                }
                html.push_str("</span>");
            }
            html.push_str("</button></h3>");
            if option.pin_key.is_some() {
                pin_button(&mut html, &option.name);
            }
            write!(
                html,
                "<div class=\"option-body\"><p class=\"kind\">{}</p>",
                option.kind.label()
            )
            .unwrap();
            if !option.details.is_empty() {
                html.push_str("<dl>");
                for detail in &option.details {
                    write!(html, "<div><dt>{}</dt><dd>", detail.label).unwrap();
                    escape(&mut html, &detail.value);
                    html.push_str("</dd></div>");
                }
                html.push_str("</dl>");
            }
            if let Some(consumable) = &option.consumable {
                render_consumable(&mut html, consumable, &option.name);
            }
            if let Some(spell) = &option.concentration {
                html.push_str("<div class=\"spell-concentration\" data-focus-spell=\"");
                escape(&mut html, &spell.name);
                html.push_str("\" data-duration-label=\"");
                escape(&mut html, spell.duration.as_deref().unwrap_or(""));
                html.push('"');
                if let Some(seconds) = spell.duration_seconds {
                    write!(html, " data-duration-seconds=\"{seconds}\"").unwrap();
                }
                html.push_str("><span>Concentration</span>");
                if option.consumable.is_none() {
                    html.push_str(
                        "<button type=\"button\" data-concentrate aria-label=\"Concentrate on ",
                    );
                    escape(&mut html, &spell.name);
                    html.push_str("\">Concentrate</button>");
                }
                html.push_str("</div>");
            }
            if !option.description.is_empty() {
                html.push_str(
                    "<details><summary>Full description</summary><div class=\"description\">",
                );
                render_description(&mut html, &option.description);
                html.push_str("</div></details>");
            }
            html.push_str("</div></article>");
        }
        html.push_str("</section>");
    }
    html.push_str("</div><p id=\"no-groups\" class=\"empty\" hidden>All action sections are hidden. Use Layout to show them again.</p><p id=\"no-options\" class=\"empty\" hidden>No matching options.</p>\
        </div><aside class=\"option-inspector\" id=\"option-inspector\" aria-label=\"Selected option\"><p class=\"empty\">Select an option to read its details.</p></aside></div></section>\
        <aside class=\"combat-sidebar\" aria-label=\"Effects and companions\">");
    html.push_str(include_str!("effects.html"));
    render_companions(&mut html, sheet);
    html.push_str(
        "</aside><p id=\"consumable-status\" class=\"visually-hidden\" role=\"status\"></p>",
    );
    html.push_str("<dialog id=\"layout-dialog\" aria-labelledby=\"layout-dialog-title\"><div class=\"dialog-heading\"><h2 id=\"layout-dialog-title\">Layout</h2><form method=\"dialog\"><button>Close</button></form></div>");
    render_layout(&mut html, sheet);
    html.push_str("</dialog><dialog id=\"character-dialog\" aria-labelledby=\"character-dialog-title\"><div class=\"dialog-heading\"><h2 id=\"character-dialog-title\">Character</h2><form method=\"dialog\"><button>Close</button></form></div>");
    render_full_sheet(&mut html, &sheet.profile);
    html.push_str("</dialog></main><script>");
    html.push_str(include_str!("preferences.js"));
    html.push_str(include_str!("encounter.js"));
    html.push_str(include_str!("companions.js"));
    html.push_str(include_str!("turns.js"));
    html.push_str(include_str!("effects.js"));
    html.push_str(include_str!("consumables.js"));
    html.push_str(include_str!("concentration.js"));
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
        write!(html, "\" data-capacity=\"{}\">", resource.capacity).unwrap();
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

fn render_consumable(html: &mut String, consumable: &ConsumableAmount, name: &str) {
    html.push_str("<div class=\"consumable\" data-consumable=\"");
    escape(html, &consumable.key);
    html.push('"');
    if let Some(amount) = consumable.remaining {
        write!(html, " data-amount=\"{amount}\"").unwrap();
    }
    html.push_str("><span>Quantity <strong data-remaining>");
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
    html.push_str(">Use</button></div>");
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
        start_card(html, Some("stat-card"), Some(&format!("stat:{key}")));
        write!(
            html,
            "<h3>{label}</h3><p class=\"stat-number\" data-stat=\"{key}\">"
        )
        .unwrap();
        escape(html, value.unwrap_or("Unavailable"));
        html.push_str("</p>");
        pin_button(html, label);
        html.push_str("</article>");
    }
    start_card(html, Some("stat-card saves-card"), Some("stat:saves"));
    html.push_str("<h3 class=\"visually-hidden\">Saving throws</h3>");
    pin_button(html, "Saving throws");
    html.push_str("<dl class=\"saves-list\">");
    for ((ability, key), value) in ABILITIES.into_iter().zip(SAVE_KEYS).zip(stats.saves) {
        let value = value.map(|value| format!("{value:+}"));
        write!(
            html,
            "<div><dt><abbr title=\"{ability}\">{}</abbr></dt><dd data-stat=\"{key}\">",
            key.to_uppercase()
        )
        .unwrap();
        html.push_str(value.as_deref().unwrap_or("—"));
        html.push_str("</dd></div>");
    }
    html.push_str("</dl></article></div></section>");
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
