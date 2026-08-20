use sele_core::{TranscriptMessage, TranscriptMessagePhase, TranscriptRole};

#[derive(Clone, Debug, Default)]
pub(super) struct TranscriptTurn {
    pub(super) user: Option<TranscriptMessage>,
    pub(super) work: Vec<TranscriptMessage>,
    pub(super) final_answer: Option<TranscriptMessage>,
}

pub(super) fn transcript_turns(messages: &[TranscriptMessage]) -> Vec<TranscriptTurn> {
    let mut turns = Vec::new();
    let mut current = TranscriptTurn::default();
    let mut responses = Vec::new();

    for message in messages {
        if message.role == TranscriptRole::User {
            if responses.is_empty()
                && let Some(user) = &mut current.user
                && reconcile_consecutive_user_messages(user, message)
            {
                continue;
            }
            finish_turn(&mut turns, &mut current, &mut responses);
            current.user = Some(message.clone());
        } else {
            responses.push(message.clone());
        }
    }
    finish_turn(&mut turns, &mut current, &mut responses);
    turns
}

fn reconcile_consecutive_user_messages(
    current: &mut TranscriptMessage,
    next: &TranscriptMessage,
) -> bool {
    let current_is_anonymous = current.id.starts_with("user:anonymous:");
    let next_is_anonymous = next.id.starts_with("user:anonymous:");
    match (current_is_anonymous, next_is_anonymous) {
        // Codex replay leaves the interrupted pre-edit message anonymous and then emits the
        // replacement with its stable item ID. Keep only the replacement.
        (true, false) => *current = next.clone(),
        // Attachments can arrive as an anonymous chunk immediately after their stable user
        // message. Keep them in the same bubble instead of creating a duplicate turn.
        (false, true) => current.blocks.extend(next.blocks.clone()),
        _ => return false,
    }
    true
}

fn finish_turn(
    turns: &mut Vec<TranscriptTurn>,
    current: &mut TranscriptTurn,
    responses: &mut Vec<TranscriptMessage>,
) {
    responses.retain(|message| message.role != TranscriptRole::Thought);
    let final_index = responses
        .iter()
        .rposition(|message| message.phase == TranscriptMessagePhase::FinalAnswer)
        .or_else(|| {
            responses
                .iter()
                .rposition(|message| message.role == TranscriptRole::Agent)
        });
    current.final_answer = final_index.map(|index| responses.remove(index));
    current.work.append(responses);

    if current.user.is_some() || current.final_answer.is_some() || !current.work.is_empty() {
        turns.push(std::mem::take(current));
    }
}

#[cfg(test)]
mod tests {
    use sele_core::{
        TranscriptBlock, TranscriptMessagePhase, TranscriptMessageState, TranscriptRole,
    };

    use super::*;

    fn message(sequence: i64, role: TranscriptRole) -> TranscriptMessage {
        TranscriptMessage::new(
            format!("message-{sequence}"),
            sequence,
            role,
            TranscriptMessageState::Complete,
        )
    }

    #[test]
    fn keeps_only_the_last_agent_message_as_the_final_answer() {
        let turns = transcript_turns(&[
            message(0, TranscriptRole::User),
            message(1, TranscriptRole::Agent),
            message(2, TranscriptRole::Thought),
            message(3, TranscriptRole::Tool),
            message(4, TranscriptRole::Agent),
        ]);

        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user.as_ref().unwrap().sequence, 0);
        assert_eq!(
            turns[0]
                .work
                .iter()
                .map(|message| message.sequence)
                .collect::<Vec<_>>(),
            vec![1, 3]
        );
        assert_eq!(turns[0].final_answer.as_ref().unwrap().sequence, 4);
    }

    #[test]
    fn starts_a_new_turn_at_each_user_message() {
        let turns = transcript_turns(&[
            message(0, TranscriptRole::User),
            message(1, TranscriptRole::Agent),
            message(2, TranscriptRole::User),
            message(3, TranscriptRole::Tool),
        ]);

        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].final_answer.as_ref().unwrap().sequence, 1);
        assert_eq!(turns[1].work[0].sequence, 3);
        assert!(turns[1].final_answer.is_none());
    }

    #[test]
    fn uses_phase_metadata_and_omits_thoughts() {
        let mut final_answer = message(2, TranscriptRole::Agent);
        final_answer.phase = TranscriptMessagePhase::FinalAnswer;
        let turns = transcript_turns(&[
            message(0, TranscriptRole::User),
            final_answer,
            message(3, TranscriptRole::Agent),
            message(4, TranscriptRole::Thought),
        ]);

        assert_eq!(turns[0].final_answer.as_ref().unwrap().sequence, 2);
        assert_eq!(turns[0].work.len(), 1);
        assert_eq!(turns[0].work[0].sequence, 3);
    }

    #[test]
    fn replaces_anonymous_pre_edit_user_message() {
        let mut original = message(0, TranscriptRole::User);
        original.id = "user:anonymous:0".into();
        original.blocks.push(TranscriptBlock::text(0, "typo"));
        let mut edited = message(1, TranscriptRole::User);
        edited.id = "user:item-1:1".into();
        edited.blocks.push(TranscriptBlock::text(0, "fixed"));

        let turns = transcript_turns(&[original, edited.clone()]);

        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user.as_ref().unwrap().id, edited.id);
    }

    #[test]
    fn merges_anonymous_attachment_into_stable_user_message() {
        let mut user = message(0, TranscriptRole::User);
        user.id = "user:item-1:0".into();
        user.blocks.push(TranscriptBlock::text(0, "message"));
        let mut attachment = message(1, TranscriptRole::User);
        attachment.id = "user:anonymous:1".into();
        attachment
            .blocks
            .push(TranscriptBlock::text(0, "attachment"));

        let turns = transcript_turns(&[user, attachment]);

        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user.as_ref().unwrap().blocks.len(), 2);
    }
}
