mod chat_project;
mod chat_row;
mod chat_view;
mod workspace;

pub use chat_project::ChatProject;
pub use chat_row::{ChatStatus, ChatSummary};
pub use chat_view::ChatView;
pub use workspace::build_workspace;

pub(crate) const STYLES: &[&str] = &[
    workspace::STYLE,
    chat_project::STYLE,
    chat_row::STYLE,
    chat_view::STYLE,
];
