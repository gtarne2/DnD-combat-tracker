use std::fmt::Write;

use crate::aurora::{ABILITIES, CharacterProfile, ContentNode, KeyStats, ProfileSection};

use super::{ActionGroup, CombatSheet};

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
    html.push_str("\"><header><div class=\"heading\"><h1>Combat sheet</h1>");
    if let Some(name) = &sheet.character_name {
        html.push_str("<p>");
        escape(&mut html, name);
        html.push_str("</p>");
    }
    html.push_str("</div></header><nav aria-label=\"Combat options\"><div>");
    html.push_str("<a href=\"#key-stats\">Stats</a><a href=\"#pinned\" id=\"pinned-link\" hidden>Pins</a><span id=\"group-navigation\">");
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
    html.push_str("</span><a href=\"#sheet-layout\" data-open-panel>Layout</a><a href=\"#full-sheet\" data-open-panel>Full sheet</a></div></nav><main>");
    render_stats(&mut html, &sheet.profile.stats);
    html.push_str("<section id=\"pinned\" aria-labelledby=\"pinned-heading\" hidden><h2 id=\"pinned-heading\">Pinned</h2><div id=\"pinned-cards\"></div></section>");
    render_layout(&mut html, sheet);
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
            start_card(&mut html, None, option.pin_key.as_deref());
            write!(html, "<p class=\"kind\">{}</p><h3>", option.kind.label()).unwrap();
            escape(&mut html, &option.name);
            html.push_str("</h3>");
            if option.pin_key.is_some() {
                pin_button(&mut html, &option.name);
            }
            if !option.details.is_empty() {
                html.push_str("<dl>");
                for detail in &option.details {
                    write!(html, "<div><dt>{}</dt><dd>", detail.label).unwrap();
                    escape(&mut html, &detail.value);
                    html.push_str("</dd></div>");
                }
                html.push_str("</dl>");
            }
            if !option.description.is_empty() {
                html.push_str(
                    "<details><summary>Full description</summary><div class=\"description\">",
                );
                render_description(&mut html, &option.description);
                html.push_str("</div></details>");
            }
            html.push_str("</article>");
        }
        html.push_str("</section>");
    }
    html.push_str("</div><p id=\"no-groups\" class=\"empty\" hidden>All action sections are hidden. Use Layout to show them again.</p>");
    render_full_sheet(&mut html, &sheet.profile);
    html.push_str("</main><script>");
    html.push_str(include_str!("preferences.js"));
    html.push_str("</script></body></html>");
    html
}

fn render_stats(html: &mut String, stats: &KeyStats) {
    html.push_str("<section id=\"key-stats\" aria-labelledby=\"stats-heading\"><h2 id=\"stats-heading\">Key stats</h2><div class=\"stat-grid\">");
    let hp = stats.max_hp.map(|value| format!("{value} max"));
    let armor = stats.armor_class.map(|value| value.to_string());
    for (key, label, value) in [
        ("hp", "HP", hp.as_deref()),
        ("ac", "Armor Class", armor.as_deref()),
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
    html.push_str("<h3>Saving throws</h3>");
    pin_button(html, "Saving throws");
    html.push_str("<dl class=\"saves-list\">");
    for ((ability, key), value) in ABILITIES.into_iter().zip(SAVE_KEYS).zip(stats.saves) {
        let value = value.map(|value| format!("{value:+}"));
        write!(html, "<div><dt>{ability}</dt><dd data-stat=\"{key}\">").unwrap();
        html.push_str(value.as_deref().unwrap_or("—"));
        html.push_str("</dd></div>");
    }
    html.push_str("</dl></article></div></section>");
}

const SAVE_KEYS: [&str; 6] = ["str", "dex", "con", "int", "wis", "cha"];

fn render_layout(html: &mut String, sheet: &CombatSheet) {
    html.push_str("<details id=\"sheet-layout\" class=\"panel\"><summary>Layout</summary><div class=\"panel-body\"><h2>Combat sections</h2><ul id=\"section-settings\">");
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
    html.push_str("<details id=\"full-sheet\" class=\"panel\"><summary>Full sheet</summary><div class=\"panel-body profile-fields\">");
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
