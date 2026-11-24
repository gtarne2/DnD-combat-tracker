use std::{ops::Range, path::Path, sync::Arc};

use roxmltree::Node;

use super::children_named;

pub(crate) const DENOMINATIONS: [(&str, &str); 5] = [
    ("copper", "Copper (cp)"),
    ("silver", "Silver (sp)"),
    ("electrum", "Electrum (ep)"),
    ("gold", "Gold (gp)"),
    ("platinum", "Platinum (pp)"),
];

/// The coin balances and the original save split around its editable values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuroraCurrency {
    /// Balances in copper, silver, electrum, gold, and platinum order.
    pub balances: [Option<u32>; DENOMINATIONS.len()],
    pub(crate) filename: String,
    pub(crate) parts: Arc<[CurrencyPart]>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CurrencyPart {
    Xml(String),
    Balance {
        coin: usize,
        original: Option<String>,
    },
}

struct CurrencyEdit {
    range: Range<usize>,
    parts: Vec<CurrencyPart>,
}

impl AuroraCurrency {
    pub(crate) const MAX: u32 = i32::MAX as u32;

    pub(super) fn read(xml: &str, build: Node<'_, '_>, path: &Path) -> Option<Self> {
        let input = unique_child(build, "input").ok()??;
        let currency = unique_child(input, "currency").ok()?;
        let mut balances = [Some(0); DENOMINATIONS.len()];
        let mut edits = Vec::new();
        let mut missing = Vec::new();
        for (coin, (tag, _)) in DENOMINATIONS.into_iter().enumerate() {
            let node = match currency {
                Some(currency) => unique_child(currency, tag).ok()?,
                None => None,
            };
            if let Some(node) = node {
                let (amount, edit) = read_amount(xml, node, coin)?;
                balances[coin] = amount;
                edits.push(edit);
            } else {
                missing.extend([
                    CurrencyPart::Xml(format!("<{tag}>")),
                    CurrencyPart::Balance {
                        coin,
                        original: None,
                    },
                    CurrencyPart::Xml(format!("</{tag}>")),
                ]);
            }
        }
        if !missing.is_empty() {
            if currency.is_none() {
                missing.insert(0, CurrencyPart::Xml("<currency>".into()));
                missing.push(CurrencyPart::Xml(
                    "<equipment></equipment><treasure></treasure></currency>".into(),
                ));
            }
            edits.push(insert_into(xml, currency.unwrap_or(input), missing)?);
        }

        edits.sort_by_key(|edit| edit.range.start);
        let mut parts = Vec::new();
        let mut end = 0;
        for edit in edits {
            parts.push(CurrencyPart::Xml(xml[end..edit.range.start].into()));
            parts.extend(edit.parts);
            end = edit.range.end;
        }
        parts.push(CurrencyPart::Xml(xml[end..].into()));

        let stem = path.file_stem()?.to_string_lossy();
        Some(Self {
            balances,
            filename: format!("{stem}-updated.dnd5e"),
            parts: parts.into(),
        })
    }
}

fn read_amount(xml: &str, node: Node<'_, '_>, coin: usize) -> Option<(Option<u32>, CurrencyEdit)> {
    let Some(text) = node.first_child() else {
        let edit = insert_into(
            xml,
            node,
            vec![CurrencyPart::Balance {
                coin,
                original: None,
            }],
        )?;
        return Some((Some(0), edit));
    };
    if !text.is_text() || text.next_sibling().is_some() {
        return None;
    }
    // The parser can combine adjacent text and CDATA into a single text node.
    let start = text.range().start;
    let end = closing_tag_start(xml, node)?;
    let raw = &xml[start..end];
    let start = start + (raw.len() - raw.trim_start().len());
    let end = start + raw.trim().len();
    let amount = text.text()?.trim();
    let amount = if amount.is_empty() {
        Some(0)
    } else {
        amount.parse().ok().filter(|&n| n <= AuroraCurrency::MAX)
    };
    let edit = CurrencyEdit {
        range: start..end,
        parts: vec![CurrencyPart::Balance {
            coin,
            original: Some(xml[start..end].into()),
        }],
    };
    Some((amount, edit))
}

fn unique_child<'a, 'input>(
    parent: Node<'a, 'input>,
    name: &'static str,
) -> Result<Option<Node<'a, 'input>>, ()> {
    let mut children = children_named(parent, name);
    let first = children.next();
    if children.next().is_some() {
        return Err(());
    }
    Ok(first)
}

fn insert_into(
    xml: &str,
    parent: Node<'_, '_>,
    mut parts: Vec<CurrencyPart>,
) -> Option<CurrencyEdit> {
    let range = parent.range();
    let element = &xml[range.clone()];
    if element.ends_with("/>") {
        let name = element[1..].split([' ', '\t', '\n', '\r', '/']).next()?;
        parts.insert(0, CurrencyPart::Xml(">".into()));
        parts.push(CurrencyPart::Xml(format!("</{name}>")));
        return Some(CurrencyEdit {
            range: range.end - 2..range.end,
            parts,
        });
    }
    let end = closing_tag_start(xml, parent)?;
    Some(CurrencyEdit {
        range: end..end,
        parts,
    })
}

fn closing_tag_start(xml: &str, node: Node<'_, '_>) -> Option<usize> {
    let range = node.range();
    Some(range.start + xml[range.clone()].rfind("</")?)
}

#[cfg(test)]
mod tests {
    use roxmltree::Document;

    use super::*;
    use crate::aurora::child;

    fn read(xml: &str) -> Option<AuroraCurrency> {
        let document = Document::parse(xml).unwrap();
        let build = child(document.root_element(), "build").unwrap();
        AuroraCurrency::read(xml, build, Path::new("Sample.dnd5e"))
    }

    fn export(currency: &AuroraCurrency, balances: [u32; 5]) -> String {
        let mut xml = String::new();
        for part in currency.parts.iter() {
            match part {
                CurrencyPart::Xml(text) => xml.push_str(text),
                CurrencyPart::Balance { coin, original } => {
                    let edited = balances[*coin];
                    if let Some(original) = original
                        && Some(edited) == currency.balances[*coin]
                    {
                        xml.push_str(original);
                    } else {
                        xml.push_str(&edited.to_string());
                    }
                }
            }
        }
        xml
    }

    #[test]
    fn updates_coin_balances_in_the_original_save_order() {
        let xml = "\u{feff}<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n\
            <character><build><input><name>Bría &amp; Co.</name><currency>\r\n\
            <silver>&#51;</silver><electrum>1</electrum><gold> 14 </gold><platinum>2</platinum><copper>8</copper>\r\n\
            <equipment></equipment><treasure>Ruby &amp; emerald</treasure></currency>\
            </input><equipment/></build><!-- <gold>99</gold> --></character>\r\n";
        let currency = read(xml).unwrap();
        assert_eq!(currency.balances, [8, 3, 1, 14, 2].map(Some));
        assert_eq!(currency.filename, "Sample-updated.dnd5e");
        assert_eq!(export(&currency, [8, 3, 1, 14, 2]), xml);

        let balances = [10, 7, 0, 27, 5];
        let updated = export(&currency, balances);
        let expected = xml
            .replace("<silver>&#51;</silver>", "<silver>7</silver>")
            .replace("<electrum>1</electrum>", "<electrum>0</electrum>")
            .replace("<gold> 14 </gold>", "<gold> 27 </gold>")
            .replace("<platinum>2</platinum>", "<platinum>5</platinum>")
            .replace("<copper>8</copper>", "<copper>10</copper>");
        assert_eq!(updated, expected);
        assert_eq!(read(&updated).unwrap().balances, balances.map(Some));
    }

    #[test]
    fn adds_missing_denominations_and_initializes_empty_values() {
        for input in [
            "<input />",
            "<input><currency /></input>",
            "<input><currency><gold /></currency></input>",
            "<input><currency><gold></gold></currency></input>",
        ] {
            let xml = format!("<character><build>{input}</build></character>");
            let currency = read(&xml).unwrap();
            assert_eq!(currency.balances, [Some(0); 5], "{input}");
            let balances = [1, 2, 3, 4, 5];
            let updated = export(&currency, balances);
            assert_eq!(
                read(&updated).unwrap().balances,
                balances.map(Some),
                "{updated}"
            );
        }
    }

    #[test]
    fn handles_unusual_values_without_editing_ambiguous_nodes() {
        let source = |silver: &str| {
            format!(
                "<character><build><input><currency><copper>0</copper>{silver}<electrum>0</electrum><gold>0</gold><platinum>0</platinum></currency></input></build></character>"
            )
        };
        let mixed_text = read(&source("<silver>1<![CDATA[2]]></silver>")).unwrap();
        assert_eq!(mixed_text.balances[1], Some(12));
        assert_eq!(export(&mixed_text, [0; 5]), source("<silver>0</silver>"));

        let invalid = read(&source("<silver>-1</silver>")).unwrap();
        assert_eq!(invalid.balances[1], None);
        assert_eq!(export(&invalid, [0; 5]), source("<silver>0</silver>"));

        assert!(read(&source("<silver>1</silver><silver>2</silver>")).is_none());
        assert!(read(&source("<silver><unknown/></silver>")).is_none());
    }
}
