use std::fmt::Write;

use crate::aurora::{
    ABILITIES, AuroraCurrency, CharacterProfile, ContentNode, CurrencyPart, DENOMINATIONS,
    KeyStats, ProfileSection, RollModifier, SKILLS,
};

use super::{ActionGroup, CombatOption, CombatSheet, ConsumableAmount, OptionKind, moxie};

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
    html.push_str(include_str!("character-sheet.css"));
    html.push_str("</style></head><body data-profile=\"");
    escape(&mut html, profile_key);
    html.push_str("\" data-session-page=\"combat\"><header class=\"command-bar\"><a class=\"brand\" href=\"#character-dialog\" data-session-nav=\"character\" aria-label=\"Aurora Combat Tracker, go to character overview\"><span class=\"brand-mark\" aria-hidden=\"true\">A</span><span><strong>Aurora</strong><small>Combat Tracker</small></span></a>\
        <nav class=\"command-nav\" aria-label=\"Tracker\"><a href=\"#combat\" id=\"combat-nav\" data-session-nav=\"combat\" aria-current=\"page\">Combat</a><button type=\"button\" id=\"character-nav\" data-session-nav=\"character\">Character</button><button type=\"button\" data-session-nav=\"features\">Features &amp; Traits</button><button type=\"button\" id=\"companions-nav\" data-session-nav=\"companions\">Companions</button><button type=\"button\" data-session-nav=\"inventory\">Inventory</button><button type=\"button\" data-session-nav=\"journal\">Journal</button></nav>\
        <p id=\"encounter-status\" class=\"focus-feedback\" role=\"status\"></p><div class=\"command-tools\" role=\"group\" aria-label=\"Sheet tools\"><button type=\"button\" id=\"review-consumables\" hidden>Review consumables</button><button type=\"button\" id=\"sheet-find\" aria-haspopup=\"dialog\" aria-keyshortcuts=\"Control+K Meta+K /\">Find on sheet <kbd>/</kbd></button><button type=\"button\" id=\"party-chip\" class=\"party-chip\" data-dialog=\"session-files\" hidden><svg class=\"icon\" aria-hidden=\"true\"><use href=\"#gi-tabletop-players\"/></svg><span class=\"party-chip-text\">Party</span><span class=\"party-chip-count\" hidden></span></button><button type=\"button\" data-dialog=\"session-files\">Session</button><button type=\"button\" class=\"settings-trigger\" data-dialog=\"sheet-settings\" aria-label=\"Settings\" title=\"Settings\">⚙</button><button type=\"button\" class=\"layout-trigger\" data-dialog=\"layout-dialog\">Layout</button></div></header><main class=\"dashboard\">");
    render_companions(&mut html, sheet);
    html.push_str("<section class=\"overview\" id=\"character-overview\" aria-label=\"Character overview\"><div class=\"identity\"><span class=\"identity-mark\" aria-hidden=\"true\">");
    let name = sheet.character_name.as_deref().unwrap_or("Character");
    let initial = name
        .chars()
        .next()
        .unwrap_or('C')
        .to_uppercase()
        .to_string();
    escape(&mut html, &initial);
    html.push_str("</span><button type=\"button\" class=\"identity-portrait\" id=\"portrait-button\" aria-label=\"Character portrait\" title=\"Character portrait\" aria-haspopup=\"dialog\"><img alt=\"\" hidden><span class=\"portrait-empty\" aria-hidden=\"true\"></span></button><div><h1>");
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
    html.push_str("<section class=\"resource-strip\" aria-labelledby=\"resource-heading\"><h2 id=\"resource-heading\">Resources</h2><ul id=\"encounter-resources\"></ul><button type=\"button\" id=\"show-all-resources\" class=\"quiet-button\" data-dialog=\"all-resources\">All pools</button><button type=\"button\" class=\"quiet-button\" data-dialog=\"resource-settings\">Manage resources</button><button type=\"button\" data-configure-moxie id=\"configure-moxie\" hidden></button></section></section>");
    html.push_str("<section class=\"combat-workspace\" id=\"combat\" aria-labelledby=\"options-heading\"><div class=\"workspace-heading\"><div class=\"workspace-title\"><h2 id=\"options-heading\">Combat options</h2><span id=\"turn-flag\" class=\"turn-flag\" hidden>Your turn</span><span id=\"economy-chips\" class=\"economy-chips\" role=\"group\" aria-label=\"This turn's actions\" hidden></span></div>\
        <div class=\"workspace-tools\"><button type=\"button\" id=\"open-companion-sidebar\" class=\"quiet-button\" aria-controls=\"companion-roster-content\">Add companion</button><label class=\"option-search\"><span class=\"visually-hidden\">Search combat options</span><input type=\"search\" id=\"option-search\" placeholder=\"Search options\"></label><button type=\"button\" id=\"toggle-skills-dock\" aria-controls=\"skills-dock\" aria-pressed=\"false\">Skills</button><button type=\"button\" id=\"toggle-inspector\" aria-controls=\"option-inspector\" aria-expanded=\"true\">Hide details</button></div></div>");
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
    html.push_str("</span><a href=\"#all-options\" data-filter=\"all\">All</a><a href=\"#all-options\" data-filter=\"traits\">Traits</a><a href=\"#pinned\" id=\"pinned-link\" data-filter=\"pinned\">Favorites</a><button type=\"button\" class=\"quiet-button\" data-dialog=\"spell-filters\">Spell filters</button><label class=\"show-unprepared\"><input type=\"checkbox\" id=\"show-unprepared\"> Show unprepared</label></nav>\
        <div class=\"combat-columns\"><div class=\"option-list\" id=\"all-options\">\
        <section id=\"bonus-followups\" hidden><h3>Active bonus actions</h3><div id=\"bonus-followup-list\"></div></section>\
        <section id=\"pinned\" aria-labelledby=\"pinned-heading\" hidden><div class=\"favorites-heading\"><h2 id=\"pinned-heading\">Favorites</h2><button type=\"button\" id=\"organize-favorites\" data-dialog=\"favorites-dialog\" aria-haspopup=\"dialog\">Organize favorites</button></div><div id=\"pinned-cards\"></div></section>");
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
            if option.summon {
                // Marks the row that gets the Create control and its variant list.
                html.pop();
                html.push_str(" data-summon-feature>");
            }
            render_option_row(&mut html, option, group.action);
            if option.pin_key.is_some() {
                pin_button(&mut html, &option.name);
            }
            write!(
                html,
                "<div class=\"option-body\" data-action-group=\"{id}\""
            )
            .unwrap();
            if let Some(item) = option.inventory {
                write!(html, " data-inventory-index=\"{}\"", item.index).unwrap();
                if item.equipped {
                    html.push_str(" data-equipped");
                }
                if let Some(quantity) = item.quantity {
                    write!(html, " data-inventory-quantity=\"{quantity}\"").unwrap();
                }
            }
            for (attribute, value) in [
                ("inventory-key", option.inventory_key.as_deref()),
                ("linked-item", option.linked_item.as_deref()),
            ] {
                if let Some(value) = value {
                    write!(html, " data-{attribute}=\"").unwrap();
                    escape(&mut html, value);
                    html.push('"');
                }
            }
            if let Some(prepared) = option.preparation {
                write!(html, " data-prepared=\"{prepared}\"").unwrap();
            }
            if option.kind == super::OptionKind::Feature
                && let Some(key) = &option.pin_key
            {
                html.push_str(" data-feature=\"");
                escape(&mut html, key);
                html.push('"');
                render_feature_attributes(&mut html, option);
            }
            write!(
                html,
                "><p class=\"kind\" data-kind=\"{}\">{} <span>· {}</span></p>",
                option.kind.label(),
                option.kind.label(),
                group.action.label()
            )
            .unwrap();
            render_option_facts(&mut html, option);
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
        </div><div id=\"inspector-divider\" role=\"separator\" aria-label=\"Resize action list\" aria-orientation=\"vertical\" aria-controls=\"all-options\" tabindex=\"0\"></div><aside class=\"option-inspector\" id=\"option-inspector\" aria-label=\"Selected option\"><p class=\"empty\">Select an option to read its details.</p></aside><aside class=\"option-inspector\" id=\"skills-dock\" aria-label=\"Combat skill reference\" hidden></aside></div></section>\
        <aside class=\"combat-sidebar\" id=\"effect-home\" aria-label=\"Encounter and active effects\">");
    render_encounter(&mut html, sheet);
    html.push_str("<div class=\"sidebar-reference\" data-view-scroll=\"effects-sidebar\">");
    html.push_str(include_str!("effects.html"));
    html.push_str(include_str!("playbook.html"));
    html.push_str("<div id=\"imported-infusions\" hidden>");
    for (id, name) in &sheet.infusions {
        html.push_str("<span");
        if let Some(bonus) = sheet.infusion_attacks.get(id) {
            write!(
                html,
                " data-attack-scope=\"{}\" data-attack-bonus=\"{}\" data-damage-bonus=\"{}\"",
                bonus.scope, bonus.attack, bonus.damage
            )
            .unwrap();
        }
        html.push_str(" data-infusion=\"");
        escape(&mut html, id);
        html.push_str("\">");
        escape(&mut html, name);
        html.push_str("</span>");
    }
    html.push_str("</div>");
    html.push_str("<div id=\"ability-imported-references\" hidden>");
    for option in &sheet.reference_features {
        let Some(key) = option.pin_key.as_deref() else {
            continue;
        };
        html.push_str("<article data-ability-source=\"option:");
        escape(&mut html, key);
        html.push('"');
        render_feature_attributes(&mut html, option);
        html.push_str("><h3>");
        escape(&mut html, &option.name);
        html.push_str("</h3>");
        render_option_facts(&mut html, option);
        if !option.description.is_empty() {
            html.push_str("<div class=\"description\">");
            render_description(&mut html, &option.description);
            html.push_str("</div>");
        }
        html.push_str("</article>");
    }
    html.push_str("</div>");
    html.push_str("</div></aside>");
    render_rolls(&mut html, sheet);
    html.push_str("<dialog id=\"layout-dialog\" aria-labelledby=\"layout-dialog-title\"><div class=\"dialog-heading\"><h2 id=\"layout-dialog-title\">Layout</h2><form method=\"dialog\"><button>Close</button></form></div>");
    render_layout(&mut html, sheet);
    html.push_str("<p><label><input type=\"checkbox\" id=\"guidance-without-concentration\"> Guidance does not require concentration at my table</label></p><button type=\"button\" data-dialog=\"encounter-settings\">Optional initiative settings</button> <button type=\"button\" data-dialog=\"portrait-dialog\">Character portrait</button>");
    html.push_str("</dialog>");
    html.push_str(include_str!("portrait.html"));
    html.push_str(include_str!("settings.html"));
    html.push_str(
        "</dialog><section class=\"sheet-page\" id=\"character-dialog\" data-view-scroll=\"character\" aria-labelledby=\"character-page-title\" hidden><h2 id=\"character-page-title\">Character</h2>",
    );
    render_character_reference(&mut html, &sheet.profile);
    render_full_sheet(&mut html, &sheet.profile);
    html.push_str("</section>\
        <section class=\"sheet-page\" id=\"features-page\" data-view-scroll=\"features\" aria-labelledby=\"features-title\" hidden><div class=\"sheet-heading\"><h2 id=\"features-title\">Features &amp; Traits</h2><button type=\"button\" id=\"manage-feature-groups\">Organize groups</button></div><div id=\"feature-groups\"></div></section>\
        <section class=\"sheet-page\" id=\"inventory-page\" data-view-scroll=\"inventory\" aria-labelledby=\"inventory-title\" hidden><h2 id=\"inventory-title\">Inventory</h2>");
    render_currency(&mut html, sheet.currency.as_ref());
    html.push_str("<div id=\"inventory-content\" class=\"reference-content\"></div></section>\
        <section class=\"sheet-page\" id=\"journal-page\" data-view-scroll=\"journal\" aria-labelledby=\"journal-title\" hidden><h2 id=\"journal-title\">Journal</h2>");
    html.push_str(include_str!("journal.html"));
    html.push_str("<div class=\"journal-columns\"><div id=\"journal-content\"></div><div id=\"notes-content\"></div></div></section>\
        <dialog id=\"favorites-dialog\" aria-labelledby=\"favorites-dialog-title\"><div class=\"dialog-heading\"><h2 id=\"favorites-dialog-title\">Organize favorites</h2><form method=\"dialog\"><button>Done</button></form></div><ol id=\"favorite-order\"></ol><p id=\"favorite-order-status\" class=\"focus-feedback\" role=\"status\"></p></dialog>\
        <dialog id=\"resource-reference\" aria-labelledby=\"resource-reference-title\"><div class=\"dialog-heading\"><h2 id=\"resource-reference-title\"></h2><form method=\"dialog\"><button>Close</button></form></div><div id=\"resource-reference-content\"></div></dialog>");
    html.push_str(include_str!("sheet-reference.html"));
    html.push_str(include_str!("session-files.html"));
    html.push_str(include_str!("combat-tools.html"));
    render_import_report(&mut html, sheet);
    html.push_str("</main><script>");
    html.push_str(include_str!("session-view.js"));
    html.push_str(include_str!("preferences.js"));
    html.push_str(include_str!("settings.js"));
    html.push_str(include_str!("portrait.js"));
    html.push_str(include_str!("encounter.js"));
    html.push_str(include_str!("party-actions.js"));
    html.push_str(include_str!("action-economy.js"));
    html.push_str(include_str!("companions.js"));
    html.push_str(include_str!("party-initiative.js"));
    html.push_str(include_str!("turns.js"));
    html.push_str(include_str!("effects.js"));
    html.push_str(include_str!("consumables.js"));
    html.push_str(include_str!("concentration.js"));
    html.push_str(include_str!("charged-items.js"));
    html.push_str(include_str!("combat-tools.js"));
    html.push_str(include_str!("attack-modifiers.js"));
    html.push_str(include_str!("playbook.js"));
    html.push_str(include_str!("quick-actions.js"));
    html.push_str(include_str!("reference-pages.js"));
    html.push_str(include_str!("rolls.js"));
    html.push_str(include_str!("sheet-reference.js"));
    html.push_str(include_str!("feature-groups.js"));
    html.push_str(include_str!("dashboard.js"));
    html.push_str(include_str!("encounter-library.js"));
    html.push_str(include_str!("journal.js"));
    html.push_str(include_str!("session-files.js"));
    html.push_str(include_str!("party-sharing.js"));
    html.push_str(include_str!("party-windows.js"));
    html.push_str(include_str!("party.js"));
    html.push_str(include_str!("import-report.js"));
    html.push_str("</script></body></html>");
    html
}

fn render_import_report(html: &mut String, sheet: &CombatSheet) {
    let stats = &sheet.profile.stats;
    html.push_str("<div id=\"import-stat-baselines\" hidden>");
    for (key, value) in [
        ("hp", stats.max_hp.map(|value| value.to_string())),
        ("ac", stats.armor_class.map(|value| value.to_string())),
        ("speed", stats.speed.clone()),
    ]
    .into_iter()
    .chain(
        SAVE_KEYS
            .into_iter()
            .zip(stats.saves)
            .map(|(key, value)| (key, value.map(|value| format!("{value:+}")))),
    ) {
        write!(html, "<span data-import-stat=\"{key}\">").unwrap();
        escape(html, value.as_deref().unwrap_or("Unavailable"));
        html.push_str("</span>");
    }
    html.push_str("</div>");
    html.push_str("<script type=\"application/json\" id=\"import-definitions\">[");
    for (index, definition) in sheet.definitions.iter().enumerate() {
        if index != 0 {
            html.push(',');
        }
        html.push('[');
        for field in [&definition.id, &definition.name, &definition.fingerprint] {
            json_string(html, field);
            html.push(',');
        }
        match &definition.source {
            Some(source) => json_string(html, source),
            None => html.push_str("null"),
        }
        html.push(']');
    }
    html.push_str("]</script>");
}

fn render_currency(html: &mut String, currency: Option<&AuroraCurrency>) {
    let Some(currency) = currency else {
        html.push_str("<p>Currency unavailable in this save.</p>");
        return;
    };
    html.push_str("<form id=\"inventory-currency\"><fieldset class=\"inventory-currency\"><legend>Currency</legend><div class=\"currency-balances\">");
    for ((tag, label), balance) in DENOMINATIONS.into_iter().zip(currency.balances) {
        write!(
            html,
            "<label>{label}<input id=\"{tag}-amount\" type=\"number\" min=\"0\" max=\"{}\" step=\"1\" inputmode=\"numeric\" required",
            AuroraCurrency::MAX
        )
        .unwrap();
        if let Some(amount) = balance {
            write!(html, " value=\"{amount}\"").unwrap();
        } else {
            html.push_str(" placeholder=\"Unknown\"");
        }
        html.push_str("></label>");
    }
    html.push_str("</div><div class=\"currency-save\"><button class=\"gold-button\" type=\"submit\">Export Aurora copy</button><p id=\"currency-save-status\" role=\"status\"></p></div></fieldset></form>");
    html.push_str("<script type=\"application/json\" id=\"aurora-currency-file\">[");
    json_string(html, &currency.filename);
    html.push_str(",[");
    for (index, part) in currency.parts.iter().enumerate() {
        if index > 0 {
            html.push(',');
        }
        match part {
            CurrencyPart::Xml(xml) => json_string(html, xml),
            CurrencyPart::Balance { coin, original } => {
                write!(html, "[{coin}").unwrap();
                if let Some(original) = original {
                    html.push(',');
                    json_string(html, original);
                }
                html.push(']');
            }
        }
    }
    html.push_str("]]</script>");
}

fn json_string(html: &mut String, value: &str) {
    html.push('"');
    for ch in value.chars() {
        match ch {
            '"' => html.push_str("\\\""),
            '\\' => html.push_str("\\\\"),
            '<' => html.push_str("\\u003c"), // Keep the JSON inside its script element.
            '\n' => html.push_str("\\n"),
            '\r' => html.push_str("\\r"),
            '\t' => html.push_str("\\t"),
            '\0'..='\u{1f}' => write!(html, "\\u{:04x}", u32::from(ch)).unwrap(),
            _ => html.push(ch),
        }
    }
    html.push('"');
}

fn render_option_facts(html: &mut String, option: &CombatOption) {
    if option.details.is_empty() {
        return;
    }
    html.push_str("<dl class=\"option-facts\">");
    for detail in &option.details {
        write!(html, "<div><dt>{}</dt><dd", detail.label).unwrap();
        match detail.label {
            "Attack roll" => roll_attribute(html, "data-base-attack", Some(&detail.value)),
            "Damage" | "Dice in description" => {
                roll_attribute(html, "data-base-damage", Some(&detail.value))
            }
            _ => (),
        }
        html.push('>');
        escape(html, &detail.value);
        html.push_str("</dd></div>");
    }
    html.push_str("</dl>");
}

fn render_feature_attributes(html: &mut String, option: &CombatOption) {
    if let Some(binding) = &option.resource_binding {
        roll_attribute(html, "data-feature-pool", Some(&binding.key));
        if let Some(cost) = binding.cost {
            write!(html, " data-feature-cost=\"{cost}\"").unwrap();
        }
    }
    if option
        .details
        .iter()
        .any(|detail| detail.label == "Uses" && detail.value.eq_ignore_ascii_case("Unlimited"))
    {
        html.push_str(" data-unlimited-feature");
    }
    if option
        .pin_key
        .as_deref()
        .is_some_and(|key| moxie::is_pool(key.trim_start_matches("Feature:"), &option.name))
    {
        html.push_str(" data-moxie-pool");
    }
    if let Some(summary) = option
        .moxie
        .and_then(|usage| usage.summary)
        .or(option.summary.as_deref())
    {
        html.push_str(" data-feature-summary=\"");
        escape(html, summary);
        html.push('"');
    }
    if let Some(usage) = option.moxie {
        use moxie::MoxieEffect::*;
        match usage.effect {
            Spend(cost) => write!(
                html,
                " data-moxie-action=\"spend\" data-moxie-cost=\"{cost}\""
            )
            .unwrap(),
            Refill => html.push_str(" data-moxie-action=\"refill\""),
            FailedSave => html.push_str(" data-moxie-action=\"failed-save\""),
        }
    }
}

fn render_encounter(html: &mut String, sheet: &CombatSheet) {
    html.push_str(include_str!("turns.html"));
    html.push_str("<div id=\"encounter-baseline\" data-owner=\"");
    escape(html, sheet.character_name.as_deref().unwrap_or("Owner"));
    write!(
        html,
        "\" data-arcane-firearm=\"{}\" data-attacks-per-action=\"{}\"",
        sheet.arcane_firearm, sheet.attacks_per_action
    )
    .unwrap();
    roll_attribute(html, "data-sneak-attack", sheet.sneak_attack.as_deref());
    html.push_str(" hidden>");
    for resource in &sheet.resources {
        html.push_str("<span data-resource=\"");
        escape(html, &resource.key);
        write!(
            html,
            "\" data-capacity=\"{}\" data-recovery=\"{}\"",
            resource.capacity, resource.recovery
        )
        .unwrap();
        if let Some(die) = resource.recharge_die {
            write!(html, " data-recharge-die=\"{die}\"").unwrap();
        }
        if let Some((die, bonus)) = resource.dawn_recharge {
            write!(html, " data-dawn-die=\"{die}\" data-dawn-bonus=\"{bonus}\"").unwrap();
        }
        html.push('>');
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

fn render_option_row(html: &mut String, option: &CombatOption, group: ActionGroup) {
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
    if let Some(usage) = option.moxie {
        use moxie::MoxieEffect::*;
        match usage.effect {
            Spend(cost) => write!(
                html,
                "<span class=\"option-badge moxie-badge\">{cost} Moxie</span>"
            )
            .unwrap(),
            Refill => html.push_str("<span class=\"option-badge moxie-badge\">Refill Moxie</span>"),
            FailedSave => html.push_str(
                "<span class=\"option-badge moxie-badge\">+1 Moxie on failed save</span>",
            ),
        }
    }
    if option.ritual {
        html.push_str("<span class=\"option-badge\">Ritual</span>");
    }
    if let Some(label) = &option.spell_options.material_notice {
        html.push_str("<span class=\"option-badge\" title=\"");
        escape(html, label);
        html.push_str("\">Material cost</span>");
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
    let healing = detail("Healing").map(|value| format!("{value} healing"));
    for (index, value) in roll
        .as_deref()
        .into_iter()
        .chain(damage.or(healing.as_deref()))
        .enumerate()
    {
        if index != 0 {
            html.push_str(" · ");
        }
        escape(html, value);
    }
    html.push_str("</span>");
    if let Some(trigger) = (group == ActionGroup::Reaction)
        .then(|| detail("Trigger"))
        .flatten()
    {
        html.push_str("<small class=\"reaction-trigger\">");
        escape(html, trigger);
        html.push_str("</small>");
    }
    html.push_str("</button></h3><div class=\"option-execute\"");
    if group != ActionGroup::Other {
        write!(html, " data-turn-cost=\"{}\"", anchor(group)).unwrap();
    }
    if !option.feature_level_available {
        html.push_str(" data-feature-level-blocked");
    }
    let spell = &option.spell_options;
    for (name, value) in [
        ("data-school", spell.school.as_deref()),
        ("data-material-notice", spell.material_notice.as_deref()),
        ("data-reaction-trigger", spell.trigger.as_deref()),
        ("data-conditional-advantage", spell.advantage),
        ("data-save-dc", detail("Save DC")),
    ] {
        roll_attribute(html, name, value);
    }
    if spell.healing || healing.is_some() {
        html.push_str(" data-healing-cast");
    }
    if !spell.incoming_events.is_empty() {
        roll_attribute(html, "data-incoming-events", Some(spell.incoming_events));
    }
    if !spell.effect.is_empty() {
        roll_attribute(html, "data-spell-effect", Some(spell.effect));
    }
    if !spell.target_counts.is_empty() {
        let counts = spell
            .target_counts
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        roll_attribute(html, "data-target-counts", Some(&counts));
    }
    if let Some(area) = &spell.area {
        roll_attribute(html, "data-spell-area", Some(&area.attribute()));
    }
    if let Some(save) = &spell.save {
        roll_attribute(html, "data-spell-save", Some(&save.attribute()));
    }
    roll_attribute(html, "data-damage-type", spell.damage_type);
    roll_attribute(html, "data-spell-colour", spell.colour.as_deref());
    if spell.overlay {
        html.push_str(" data-spell-overlay");
    }
    if let Some(note) = &option.attunement {
        roll_attribute(html, "data-attunement-note", Some(note));
        roll_attribute(html, "data-attunement-key", option.inventory_key.as_deref());
        if option.initially_attuned {
            html.push_str(" data-initially-attuned");
        }
    }
    if option.hit_maneuver {
        html.push_str(" data-hit-maneuver");
    }
    if matches!(option.kind, OptionKind::Attack | OptionKind::Spell) {
        write!(
            html,
            " data-attack-kind=\"{}\"",
            if option.kind == OptionKind::Attack {
                "weapon"
            } else {
                "spell"
            }
        )
        .unwrap();
        roll_attribute(html, "data-base-attack", detail("Attack roll"));
        roll_attribute(html, "data-base-damage", damage);
    }
    if option.artificer_damage {
        html.push_str(" data-firearm-eligible");
    }
    html.push_str("><small class=\"option-roll-adjustment\" data-roll-adjustment hidden></small>");
    if let Some(consumable) = &option.consumable {
        render_consumable(html, consumable, &option.name, option.kind);
    } else if let (Some(cost), Some(key)) = (option.charge_cost, &option.inventory_key) {
        write!(
            html,
            "<button type=\"button\" data-charge-cost=\"{cost}\" data-charge-key=\"Charge:"
        )
        .unwrap();
        escape(html, key);
        html.push_str("\" data-charge-name=\"");
        escape(html, &option.name);
        html.push_str("\">Activate</button><small data-charge-count></small><button type=\"button\" class=\"quiet-button\" data-bind-charge>Bind pool</button>");
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
                if !option.cast_previews.is_empty() {
                    roll_attribute(
                        html,
                        "data-cast-previews",
                        Some(&option.cast_previews.join("|")),
                    );
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

fn roll_attribute(html: &mut String, name: &str, value: Option<&str>) {
    if let Some(value) = value {
        write!(html, " {name}=\"").unwrap();
        escape(html, value);
        html.push('"');
    }
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
            html.push_str("<span class=\"hp-meter\" aria-hidden=\"true\"><span></span></span><span class=\"temp-hp\" data-temp-hp hidden></span><div class=\"hp-quick\" data-hp-quick><input type=\"number\" data-hp-amount min=\"0\" max=\"4294967295\" inputmode=\"numeric\" placeholder=\"HP\" aria-label=\"HP amount\" title=\"Type a number, then choose what it does. Leave empty to open the full form.\"><div class=\"health-actions\"><button type=\"button\" data-hp-op=\"damage\" data-dialog=\"damage-dialog\" aria-label=\"Record damage\">Damage</button><button type=\"button\" data-hp-op=\"heal\" data-dialog=\"heal-owner\">Heal</button><button type=\"button\" data-hp-op=\"set\" data-dialog=\"hp-settings\">Set HP</button><button type=\"button\" data-hp-op=\"temp\" data-dialog=\"hp-settings\" title=\"Gain temporary HP (keeps the higher amount)\">Temp HP</button></div></div><button type=\"button\" class=\"rest-button\" data-dialog=\"rest-picker\">Rest</button>");
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
    html.push_str("</div><button class=\"quiet-button\" type=\"button\" data-dialog=\"roll-dialog\" aria-haspopup=\"dialog\">Roll Bonuses</button>");
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
            // The casting ability modifier, for the Protector's 1d8 + modifier roll.
            if let Some(proficiency) = sheet.profile.rolls.proficiency_bonus {
                let modifier = i32::from(dc) - 8 - i32::from(proficiency);
                write!(html, " data-modifier=\"{modifier}\"").unwrap();
            }
        }
        html.push_str("></span>");
    }
    let rolls = &sheet.profile.rolls;
    html.push_str("<dialog id=\"roll-dialog\" aria-labelledby=\"roll-heading\"><div class=\"dialog-heading\"><h2 id=\"roll-heading\">Roll Bonuses</h2><form method=\"dialog\"><button>Close</button></form></div><div class=\"roll-tools\"><label class=\"visually-hidden\" for=\"roll-search\">Search roll bonuses</label><input id=\"roll-search\" type=\"search\" placeholder=\"Search rolls\" autofocus><div class=\"roll-tabs\" role=\"group\" aria-label=\"Roll categories\">");
    for (id, label) in ROLL_CATEGORIES {
        writeln!(html, "<button type=\"button\" data-roll-tab=\"{id}\" aria-controls=\"roll-{id}\" aria-pressed=\"{}\">{label}</button>", id == "skills").unwrap();
    }
    html.push_str("</div></div><div class=\"roll-results\"><p id=\"roll-empty\" class=\"empty\" role=\"status\" hidden>No matching rolls.</p>");
    roll_section(html, "skills");
    html.push_str("<div class=\"passive-rolls\">");
    for (index, name) in [
        "Passive Perception",
        "Passive Investigation",
        "Passive Insight",
    ]
    .into_iter()
    .enumerate()
    {
        let value =
            rolls.passive[index].map_or_else(|| "Unavailable".into(), |score| score.to_string());
        writeln!(
            html,
            "<p data-roll-entry data-roll-name=\"{name}\"><span>{name}</span><strong>{value}</strong></p>"
        )
        .unwrap();
    }
    html.push_str("</div><div class=\"roll-grid\">");
    for ((name, ability), roll) in SKILLS.into_iter().zip(rolls.skills) {
        render_modifier(html, name, ability, roll, false);
    }
    html.push_str("</div></section>");

    for (id, values) in [("saves", rolls.saves), ("checks", rolls.checks)] {
        roll_section(html, id);
        html.push_str("<div class=\"roll-grid\">");
        for (index, (name, roll)) in ABILITIES.into_iter().zip(values).enumerate() {
            render_modifier(html, name, index, roll, id == "saves");
        }
        html.push_str("</div></section>");
    }

    roll_section(html, "attacks");
    html.push_str("<dl class=\"roll-exports\">");
    for casting in &sheet.casting_rolls {
        html.push_str("<div class=\"roll-export\" data-roll-entry><dt>");
        escape(html, casting.name.as_deref().unwrap_or("Spellcasting"));
        html.push_str("</dt><dd>");
        let attack = casting
            .attack_bonus
            .map(|value| format!("{value:+}"))
            .unwrap_or_else(|| "Unavailable".into());
        let dc = casting
            .save_dc
            .map(|value| value.to_string())
            .unwrap_or_else(|| "Unavailable".into());
        write!(html, "Spell attack <strong>{attack}</strong> · Spell save DC <strong>{dc}</strong><small>Exported spellcasting totals</small>").unwrap();
        if let Some(ability) = casting.ability.as_deref()
            && let Some(index) = ABILITIES
                .iter()
                .position(|name| name.eq_ignore_ascii_case(ability))
        {
            write!(
                html,
                "<small>{} modifier {} · Character proficiency {}</small>",
                ABILITIES[index],
                signed_roll(sheet.profile.stats.modifiers[index]),
                signed_roll(rolls.proficiency_bonus)
            )
            .unwrap();
        }
        html.push_str("</dd></div>");
    }
    let mut seen = std::collections::HashSet::new();
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
            && seen.insert((&option.name, &roll.value))
        {
            html.push_str("<div class=\"roll-export\" data-roll-entry><dt>");
            escape(html, &option.name);
            html.push_str("</dt><dd>Attack roll <strong>");
            escape(html, &roll.value);
            html.push_str("</strong>");
            if let Some(range) = option.details.iter().find(|detail| detail.label == "Range") {
                html.push_str("<small>");
                escape(html, &range.value);
                html.push_str("</small>");
            }
            html.push_str("</dd></div>");
        }
    }
    html.push_str("</dl>");
    if sheet.casting_rolls.is_empty() && seen.is_empty() {
        html.push_str("<p class=\"empty\" data-roll-unfiltered>No attack or spellcasting totals were imported.</p>");
    }
    html.push_str("</section>");

    roll_section(html, "other");
    html.push_str("<div class=\"roll-grid\">");
    render_modifier(html, "Initiative", 1, rolls.initiative, false);
    for tool in &rolls.tools {
        html.push_str("<p class=\"roll-tool\" data-roll-entry><span>");
        escape(html, &tool.name);
        write!(
            html,
            "<small>Tool · {} bonus</small></span><strong>{}</strong></p>",
            tool.training.label(),
            signed_roll(tool.bonus)
        )
        .unwrap();
    }
    html.push_str("</div>");
    if rolls.tools.is_empty() {
        html.push_str(
            "<p class=\"empty\" data-roll-unfiltered>No tool proficiencies were imported.</p>",
        );
    } else {
        html.push_str("<p class=\"empty\" data-roll-unfiltered>Add the listed tool proficiency bonus to the ability modifier for the check.</p>");
    }
    html.push_str("</section></div></dialog>");
}

const ROLL_CATEGORIES: [(&str, &str); 5] = [
    ("skills", "Skills"),
    ("saves", "Saving Throws"),
    ("checks", "Ability Checks"),
    ("attacks", "Attacks &amp; Spells"),
    ("other", "Tools &amp; Other"),
];

fn roll_section(html: &mut String, id: &str) {
    let (_, label) = ROLL_CATEGORIES.iter().find(|(key, _)| *key == id).unwrap();
    let hidden = if id == "skills" { "" } else { " hidden" };
    writeln!(html, "<section id=\"roll-{id}\" data-roll-section=\"{id}\" aria-labelledby=\"roll-{id}-heading\"{hidden}><h3 id=\"roll-{id}-heading\" hidden>{label}</h3>").unwrap();
}

fn signed_roll(value: Option<i32>) -> String {
    value.map_or_else(|| "Unavailable".into(), |n| format!("{n:+}"))
}

fn render_modifier(html: &mut String, name: &str, index: usize, roll: RollModifier, save: bool) {
    let ability = ABILITIES[index];
    let short = SAVE_KEYS[index].to_ascii_uppercase();
    let training = roll.training.label();
    let total = signed_roll(roll.total());
    write!(
        html,
        "<details class=\"roll-entry\" data-roll-entry data-roll-name=\"{name}\""
    )
    .unwrap();
    if save {
        write!(html, " data-roll-save=\"{}\"", SAVE_KEYS[index]).unwrap();
    }
    writeln!(html, "><summary><span>{name} <abbr title=\"{ability}\">{short}</abbr><small>{training}</small></span><strong>{total}</strong></summary><dl class=\"roll-breakdown\">").unwrap();
    let modifier = format!("{ability} modifier");
    for (label, value) in [
        (modifier.as_str(), roll.ability),
        ("Proficiency", roll.proficiency),
        ("Other modifiers", roll.other),
        ("Total", roll.total()),
    ] {
        writeln!(
            html,
            "<div><dt>{label}</dt><dd>{}</dd></div>",
            signed_roll(value)
        )
        .unwrap();
    }
    if save {
        html.push_str("<div data-save-override hidden><dt>Tracker override</dt><dd></dd></div>");
    }
    html.push_str("</dl>");
    if roll.total().is_none() {
        html.push_str(
            "<p class=\"roll-note\">Required Aurora data or rule inputs are unavailable.</p>",
        );
    }
    html.push_str("</details>");
}

const SAVE_KEYS: [&str; 6] = ["str", "dex", "con", "int", "wis", "cha"];

fn render_layout(html: &mut String, sheet: &CombatSheet) {
    html.push_str("<details id=\"sheet-layout\" class=\"panel\" open><summary>Combat sections and stats</summary><div class=\"panel-body\"><label><input type=\"checkbox\" id=\"compact-combat\"> Compact Combat layout</label><ul id=\"section-settings\">");
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
    html.push_str("<details id=\"full-sheet\" class=\"panel\" data-view-disclosure=\"full-sheet\" open><summary>Full sheet</summary><div class=\"panel-body profile-fields\">");
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

fn render_character_reference(html: &mut String, profile: &CharacterProfile) {
    let rolls = &profile.rolls;
    html.push_str("<div class=\"character-reference\"><section class=\"reference-card\" id=\"character-skills\" aria-label=\"Skills\"><h3>Skills</h3><ul class=\"glance-skills\">");
    for ((name, ability), roll) in SKILLS.into_iter().zip(rolls.skills) {
        glance_roll(html, "skills", name, Some(ability), roll, false);
    }
    html.push_str("</ul><div class=\"glance-passives\">");
    for (index, name) in [
        "Passive Perception",
        "Passive Investigation",
        "Passive Insight",
    ]
    .into_iter()
    .enumerate()
    {
        if index > 0 && rolls.passive[index].is_none() {
            continue;
        }
        let value = rolls.passive[index].map_or_else(|| "—".into(), |value| value.to_string());
        write!(html, "<button type=\"button\" data-open-roll=\"skills|{name}\"><span>{name}</span><strong>{value}</strong></button>").unwrap();
    }
    html.push_str("</div></section><div class=\"character-reference-side\"><section class=\"reference-card\" aria-label=\"Saving throws\"><h3>Saving throws</h3><ul class=\"glance-saves\">");
    for (index, roll) in rolls.saves.into_iter().enumerate() {
        glance_roll(html, "saves", ABILITIES[index], Some(index), roll, true);
    }
    html.push_str("</ul></section><section class=\"reference-card exploration-reference\" aria-label=\"Exploration\"><h3>Exploration</h3><dl>");
    let tools = rolls
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    for (label, value) in [
        ("Senses", profile.senses.join(", ")),
        ("Movement", profile.stats.speed.clone().unwrap_or_default()),
        ("Languages", profile.languages.join(", ")),
        ("Tools", tools),
    ] {
        write!(html, "<div data-sheet-fact><dt>{label}</dt><dd>").unwrap();
        escape(
            html,
            if value.is_empty() {
                "Unavailable"
            } else {
                &value
            },
        );
        html.push_str("</dd></div>");
    }
    html.push_str("</dl>");
    if let Some(feature) = profile
        .fields
        .iter()
        .find(|field| field.section == ProfileSection::Background && field.label == "Feature")
    {
        html.push_str("<details class=\"background-reference\" data-view-disclosure=\"background-feature\"><summary>");
        escape(html, &feature.value);
        html.push_str(" <small>Background feature</small></summary><p>");
        if let Some(description) = profile
            .fields
            .iter()
            .find(|field| field.label == "Feature description")
        {
            escape(html, &description.value);
        }
        html.push_str("</p></details>");
    }
    html.push_str("</section></div></div><section class=\"reference-card character-abilities\" aria-label=\"Ability scores\"><div class=\"ability-score-heading\"><h3>Ability scores</h3><div class=\"ability-score-rolls\">");
    write!(html, "<p>Proficiency bonus <strong>{}</strong></p><button type=\"button\" data-open-roll=\"other|Initiative\">Initiative <strong>{}</strong></button>", signed_roll(rolls.proficiency_bonus), signed_roll(rolls.initiative.total())).unwrap();
    html.push_str("</div></div><ul class=\"ability-score-list\">");
    for (index, ability) in ABILITIES.into_iter().enumerate() {
        let score =
            profile.stats.scores[index].map_or_else(|| "—".into(), |score| score.to_string());
        let modifier =
            profile.stats.modifiers[index].map_or_else(|| "—".into(), |value| format!("{value:+}"));
        write!(html, "<li><button type=\"button\" data-open-roll=\"checks|{ability}\"><span>{ability}</span><span><b>{score}</b><small aria-label=\"Modifier {modifier}\">{modifier}</small></span></button></li>").unwrap();
    }
    html.push_str("</ul></section><div class=\"character-reference-links\"><button type=\"button\" data-session-nav=\"features\">Features &amp; Traits</button><button type=\"button\" data-session-nav=\"inventory\">Inventory</button><button type=\"button\" data-dialog=\"roll-dialog\">All roll bonuses</button></div>");
}

fn glance_roll(
    html: &mut String,
    group: &str,
    name: &str,
    ability: Option<usize>,
    roll: RollModifier,
    save: bool,
) {
    write!(
        html,
        "<li><button type=\"button\" data-open-roll=\"{group}|{name}\"><span>{name}</span>"
    )
    .unwrap();
    if let Some(index) = ability {
        let label = roll.training.label();
        if !label.is_empty() {
            write!(html, "<span class=\"glance-training\" title=\"{label}\" aria-label=\"{label}\">{}</span>", if label == "Expertise" { "◆" } else { "●" }).unwrap();
        }
        if !save {
            write!(
                html,
                "<small>{}</small>",
                SAVE_KEYS[index].to_ascii_uppercase()
            )
            .unwrap();
        }
    }
    html.push_str("<strong");
    if save && let Some(index) = ability {
        write!(html, " data-glance-save=\"{}\"", SAVE_KEYS[index]).unwrap();
    }
    let value = roll
        .total()
        .map_or_else(|| "—".into(), |value| format!("{value:+}"));
    write!(html, ">{value}</strong></button></li>").unwrap();
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
