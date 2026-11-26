use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WindowRef {
    pub id: Uuid,
    pub version: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Question {
    Attack,
    Save,
    MagicMissile,
}

impl Question {
    pub(super) fn accepts(self, answer: Answer, reacted: bool) -> bool {
        matches!(
            (self, answer, reacted),
            (_, Answer::Pass, false)
                | (
                    Self::Attack | Self::MagicMissile,
                    Answer::Hit | Answer::Miss,
                    _
                )
                | (Self::Save, Answer::SaveSuccess | Answer::SaveFailure, false)
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Answer {
    Hit,
    Miss,
    SaveSuccess,
    SaveFailure,
    Pass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub answer: Answer,
    pub reacted: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WindowEdit {
    Open {
        id: Uuid,
        question: Question,
        announcement: String,
    },
    Resume {
        window: WindowRef,
    },
    Cancel {
        window: WindowRef,
    },
    Override {
        window: WindowRef,
        outcome: super::monster_actions::Outcome,
        note: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum Resolution {
    Pending,
    Answered,
    Stale,
    Canceled,
    Final {
        outcome: super::monster_actions::Outcome,
        override_note: Option<String>,
    },
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Window {
    pub reference: WindowRef,
    pub question: Question,
    pub action: Uuid,
    pub recipient: Uuid,
    pub target: Uuid,
    pub resolution: Resolution,
    pub reply: Option<Reply>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionView {
    pub window: WindowRef,
    pub question: Question,
}

impl Window {
    pub(super) fn question_view(&self) -> QuestionView {
        QuestionView {
            window: self.reference,
            question: self.question,
        }
    }
}
