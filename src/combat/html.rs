use std::fmt::Write;

use crate::aurora::ContentNode;

use super::{ActionGroup, CombatSheet};

/// Renders a standalone preview without a network connection or client-side dependencies.
pub fn render_html(sheet: &CombatSheet) -> String {
    let mut html = String::from(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <title>Combat sheet</title><style>",
    );
    html.push_str(include_str!("sheet.css"));
    html.push_str("</style></head><body><header><div class=\"heading\"><h1>Combat sheet</h1>");
    if let Some(name) = &sheet.character_name {
        html.push_str("<p>");
        escape(&mut html, name);
        html.push_str("</p>");
    }
    html.push_str("</div></header><nav aria-label=\"Combat options\"><div>");
    for group in &sheet.groups {
        if group.action != ActionGroup::Other || !group.options.is_empty() {
            write!(
                html,
                "<a href=\"#{}\">{}</a>",
                anchor(group.action),
                group.action.label()
            )
            .unwrap();
        }
    }
    html.push_str("</div></nav><main>");
    for group in &sheet.groups {
        if group.action == ActionGroup::Other && group.options.is_empty() {
            continue;
        }
        let id = anchor(group.action);
        write!(
            html,
            "<section id=\"{id}\" aria-labelledby=\"{id}-heading\"><h2 id=\"{id}-heading\">{}</h2>",
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
            write!(
                html,
                "<article><p class=\"kind\">{}</p><h3>",
                option.kind.label()
            )
            .unwrap();
            escape(&mut html, &option.name);
            html.push_str("</h3>");
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
    html.push_str("</main></body></html>");
    html
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
