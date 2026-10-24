use super::{models::*, schema::*};
use crate::error::Error;
use diesel::prelude::*;
use sha2::{Digest, Sha256};

/// Hash the stored row and joined metadata before any lossy PGN decoding. No
/// schema/version migration or identity columns in the owner's database.
pub(super) fn identity(
    game: &Game,
    white: &Player,
    black: &Player,
    event: &Event,
    site: &Site,
) -> String {
    let snapshot = serde_json::to_vec(&(game, white, black, event, site))
        .expect("database game snapshots contain only JSON-serializable values");
    hex::encode(Sha256::digest(snapshot))
}

pub(super) fn read_identity(db: &mut SqliteConnection, game_id: i32) -> Result<String, Error> {
    let (white, black) = diesel::alias!(players as save_white, players as save_black);
    let row: Option<(Game, Player, Player, Event, Site)> = games::table
        .inner_join(white.on(games::white_id.eq(white.field(players::id))))
        .inner_join(black.on(games::black_id.eq(black.field(players::id))))
        .inner_join(events::table.on(games::event_id.eq(events::id)))
        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
        .filter(games::id.eq(game_id))
        .first(db)
        .optional()?;
    let (game, white, black, event, site) =
        row.ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;
    Ok(identity(&game, &white, &black, &event, &site))
}
