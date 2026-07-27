use pgn_reader::{BufferedReader, Nag, RawHeader, SanPlus, Skip, Visitor};
use serde::Serialize;
use specta::Type;

use crate::error::Error;

struct Lexer {
    tokens: Vec<Token>,
}

#[derive(Serialize, Clone, Type)]
#[serde(tag = "type", content = "value")]
pub enum Token {
    ParenOpen,
    ParenClose,
    Comment(String),
    San(String),
    Header { tag: String, value: String },
    Nag(String),
    Outcome(String),
}

impl Visitor for Lexer {
    type Result = Result<Vec<Token>, String>;

    fn san(&mut self, san: SanPlus) {
        self.tokens.push(Token::San(san.to_string()));
    }

    fn header(&mut self, key: &[u8], value: RawHeader<'_>) {
        self.tokens.push(Token::Header {
            tag: String::from_utf8_lossy(key).to_string(),
            value: String::from_utf8_lossy(value.as_bytes()).to_string(),
        });
    }
    fn nag(&mut self, nag: Nag) {
        self.tokens.push(Token::Nag(nag.to_string()));
    }

    fn begin_variation(&mut self) -> Skip {
        self.tokens.push(Token::ParenOpen);
        Skip(false)
    }

    fn end_variation(&mut self) {
        self.tokens.push(Token::ParenClose);
    }

    fn comment(&mut self, comment: pgn_reader::RawComment<'_>) {
        self.tokens.push(Token::Comment(
            String::from_utf8_lossy(comment.as_bytes()).to_string(),
        ));
    }

    fn end_game(&mut self) -> Self::Result {
        Ok(self.tokens.clone())
    }

    fn outcome(&mut self, outcome: Option<shakmaty::Outcome>) {
        self.tokens.push(Token::Outcome(
            outcome.map(|o| o.to_string()).unwrap_or("*".to_string()),
        ));
    }
}

#[tauri::command]
#[specta::specta]
pub async fn lex_pgn(pgn: String) -> Result<Vec<Token>, Error> {
    Ok(lex_pgn_tokens(&pgn)?)
}

fn lex_pgn_tokens(pgn: &str) -> Result<Vec<Token>, Error> {
    let mut reader = BufferedReader::new(pgn.as_bytes());

    let mut lexer = Lexer { tokens: Vec::new() };

    reader.read_game(&mut lexer)?;

    Ok(lexer.tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chessable_prose_and_key_marker_are_both_lexed() {
        let pgn = r#"[Event "Course introduction"]
[Result "*"]

{ Full prose annotation. } 1. { -KEY- } *
"#;

        let tokens = lex_pgn_tokens(pgn).unwrap();
        let comments = tokens
            .iter()
            .filter_map(|token| match token {
                Token::Comment(comment) => Some(comment.trim()),
                _ => None,
            })
            .collect::<Vec<_>>();
        let sans = tokens
            .iter()
            .filter(|token| matches!(token, Token::San(_)))
            .count();

        assert_eq!(comments, vec!["Full prose annotation.", "-KEY-"]);
        assert_eq!(sans, 0);
    }
}
