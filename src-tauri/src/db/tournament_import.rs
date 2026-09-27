//! Add new tournament games transactionally without replacing saved annotations.
use super::*;
use sha2::{Digest, Sha256};

fn game_key(row: (i32, i32, i32, Option<String>, Option<String>, Option<String>, i32, i32, Option<String>, Option<String>, Vec<u8>)) -> (i32, DuplicateGameKey) {
    let (id,event_id,site_id,date,time,round,white_id,black_id,result,fen,moves)=row;
    (id,DuplicateGameKey{event_id,site_id,date,time,round,white_id,black_id,result,fen,mainline:iter_mainline_move_bytes(&moves).collect()})
}

fn append(db: &mut SqliteConnection, file: &Path, job_id: &str) -> Result<u32, Error> {
    if job_id.is_empty() || job_id.len()>120 || !job_id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-') {
        return Err(io::Error::other("Invalid OTB update identity.").into());
    }
    // A caller cannot turn a random database into an importer-owned target.
    let owner:Option<String>=info::table.filter(info::name.eq("OtbSaveJobId")).select(info::value).first(db).optional()?.flatten();
    if owner.is_none(){return Err(io::Error::other("This database was not created by the OTB importer.").into());}
    let mut source=File::open(file)?;
    let mut hasher=Sha256::new();std::io::copy(&mut source,&mut hasher)?;
    let fingerprint=hex::encode(hasher.finalize());
    let receipt=format!("OtbUpdate:{job_id}");
    db.transaction::<u32,Error,_>(|db| {
        let prior:Option<String>=info::table.filter(info::name.eq(&receipt)).select(info::value).first(db).optional()?.flatten();
        if let Some(prior)=prior {
            if prior!=fingerprint{return Err(io::Error::other("The saved OTB update has different source games.").into());}
            return Ok(games::table.count().get_result::<i64>(db)? as u32);
        }
        let selection=(games::id,games::event_id,games::site_id,games::date,games::time,games::round,games::white_id,games::black_id,games::result,games::fen,games::moves);
        let rows=games::table.select(selection).load(db)?;
        let mut known:std::collections::HashSet<_>=rows.into_iter().map(|r|game_key(r).1).collect();
        let mut reader=BufferedReader::new(File::open(file)?);
        let mut importer=Importer::new(None);
        // Parser errors roll back the whole update, including its receipt.
        while let Some(game)=reader.read_game(&mut importer)? {
            let Some(game)=game else{continue;};
            game.insert_to_db(db)?;
            let row=games::table.order(games::id.desc()).select(selection).first(db)?;
            let (id,key)=game_key(row);
            if !known.insert(key){diesel::delete(games::table.filter(games::id.eq(id))).execute(db)?;}
        }
        let mut after=File::open(file)?;let mut check=Sha256::new();std::io::copy(&mut after,&mut check)?;
        if hex::encode(check.finalize())!=fingerprint{return Err(io::Error::other("OTB source changed during saving. Retry the saved import.").into());}
        delete_orphaned_data(db)?;
        let count=games::table.count().get_result::<i64>(db)?;
        for (name,value) in [("GameCount",count),("PlayerCount",players::table.count().get_result(db)?),("EventCount",events::table.count().get_result(db)?),("SiteCount",sites::table.count().get_result(db)?)] {update_info_count(db,name,value)?;}
        insert_into(info::table).values((info::name.eq(receipt),info::value.eq(fingerprint))).execute(db)?;
        Ok(count as u32)
    })
}

#[tauri::command]
#[specta::specta]
pub async fn append_tournament_games(file:PathBuf,db_path:PathBuf,job_id:String,state:tauri::State<'_,AppState>)->Result<u32,Error>{
    let key=db_path.to_string_lossy().to_string();
    let _guard=match state.active_conversions.entry(key.clone()) {
        dashmap::mapref::entry::Entry::Occupied(_)=>return Err(Error::ConversionInProgress(key)),
        dashmap::mapref::entry::Entry::Vacant(entry)=>{entry.insert(());ActiveConversionGuard{conversions:&state.active_conversions,key:key.clone()}}
    };
    if !db_path.is_file(){return Err(io::Error::other("The opponent database was removed. Import into a new database.").into());}
    state.connection_pool.remove(&key);
    let db=&mut get_db_or_create(&state,&key,ConnectionOptions::default())?;
    let count=append(db,&file,&job_id)?;
    invalidate_database_search_index(&state,&db_path);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database()->SqliteConnection{
        let mut db=SqliteConnection::establish(":memory:").unwrap();
        ensure_database_schema_for_import(&mut db,"Opponent","Public games").unwrap();
        insert_into(info::table).values((info::name.eq("OtbSaveJobId"),info::value.eq("otb-original"))).execute(&mut db).unwrap();
        db
    }
    const GAME:&str="[Event \"Synthetic tournament\"]\n[Site \"Fixture\"]\n[Date \"2026.09.01\"]\n[White \"Player A\"]\n[Black \"Player B\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n";
    #[test]
    fn repeated_updates_preserve_existing_annotations_and_ids(){
        let mut db=database();let dir=tempfile::tempdir().unwrap();let pgn=dir.path().join("games.pgn");
        std::fs::write(&pgn,GAME.replace("e4","e4 {owner note}")).unwrap();
        assert_eq!(append(&mut db,&pgn,"otb-first").unwrap(),1);
        let before:Vec<(i32,Vec<u8>)>=games::table.select((games::id,games::moves)).load(&mut db).unwrap();
        std::fs::write(&pgn,format!("{GAME}\n{}",GAME.replace("2026.09.01","2026.09.02"))).unwrap();
        assert_eq!(append(&mut db,&pgn,"otb-second").unwrap(),2);
        assert_eq!(append(&mut db,&pgn,"otb-second").unwrap(),2);
        let retained:(i32,Vec<u8>)=games::table.filter(games::id.eq(before[0].0)).select((games::id,games::moves)).first(&mut db).unwrap();
        assert_eq!(retained,before[0]);
    }
    #[test]
    fn changed_source_for_same_job_is_refused(){
        let mut db=database();let dir=tempfile::tempdir().unwrap();let pgn=dir.path().join("games.pgn");
        std::fs::write(&pgn,GAME).unwrap();append(&mut db,&pgn,"otb-first").unwrap();
        std::fs::write(&pgn,GAME.replace("2026.09.01","2026.09.02")).unwrap();
        assert!(append(&mut db,&pgn,"otb-first").is_err());
        assert_eq!(games::table.count().get_result::<i64>(&mut db).unwrap(),1);
    }
    #[test]
    fn unowned_database_is_never_adopted(){
        let mut db=database();diesel::delete(info::table.filter(info::name.eq("OtbSaveJobId"))).execute(&mut db).unwrap();
        let dir=tempfile::tempdir().unwrap();let pgn=dir.path().join("games.pgn");std::fs::write(&pgn,GAME).unwrap();
        assert!(append(&mut db,&pgn,"otb-first").is_err());
        assert_eq!(games::table.count().get_result::<i64>(&mut db).unwrap(),0);
    }
}
