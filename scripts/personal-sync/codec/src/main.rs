//! Private bridge codec only. Reuses En Croissant's pinned move representation.
mod error { pub type Error = Box<dyn std::error::Error + Send + Sync + 'static>; }
#[allow(dead_code)]
#[path = "../../../../src-tauri/src/db/encoding.rs"]
mod encoding;
use pgn_reader::{BufferedReader, Nag, RawComment, RawHeader, SanPlus, Skip, Visitor};
use shakmaty::{fen::Fen, Chess, CastlingMode, FromSetup, Position, PositionError, Role, Color};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::collections::BTreeMap;

struct Frame { position: Chess, before: Option<Chess> }
#[derive(Default)]
struct Encoder { headers:BTreeMap<String,String>, moves:Vec<u8>, frames:Vec<Frame>, problem:Option<String>, plies:usize, min_material:[u32;2] }
fn material(p:&Chess,c:Color)->u32 { [Role::Pawn,Role::Knight,Role::Bishop,Role::Rook,Role::Queen].iter().zip([1,3,3,5,9]).map(|(r,v)|p.board().by_piece(shakmaty::Piece{color:c,role:*r}).count() as u32*v).sum() }
fn position(fen:&str)->Result<Chess,String> { let f=Fen::from_ascii(fen.as_bytes()).map_err(|e|e.to_string())?;let setup=f.into_setup();let mode=CastlingMode::detect(&setup);Chess::from_setup(setup,mode).or_else(PositionError::ignore_too_much_material).map_err(|e|e.to_string()) }
impl Visitor for Encoder {
 type Result=Result<Value,String>;
 fn begin_game(&mut self){*self=Self::default();}
 fn header(&mut self,k:&[u8],v:RawHeader<'_>){ self.headers.insert(String::from_utf8_lossy(k).into_owned(),v.decode_utf8_lossy().into_owned()); }
 fn end_headers(&mut self)->Skip {
  let p=self.headers.get("FEN").map(|s|position(s)).unwrap_or_else(||Ok(Chess::default()));
  match p {Ok(p)=>{self.min_material=[material(&p,Color::White),material(&p,Color::Black)];self.frames.push(Frame{position:p,before:None});Skip(false)},Err(e)=>{self.problem=Some(e);Skip(true)}}
 }
 fn san(&mut self,san:SanPlus){
  if self.problem.is_some(){return;}
  let main=self.frames.len()==1;let frame=self.frames.last_mut().unwrap();
  match san.san.to_move(&frame.position) {
   Ok(m)=>{self.moves.push(encoding::encode_move(&m,&frame.position).unwrap());frame.before=Some(frame.position.clone());frame.position.play_unchecked(&m);if main{self.plies+=1;self.min_material[0]=self.min_material[0].min(material(&frame.position,Color::White));self.min_material[1]=self.min_material[1].min(material(&frame.position,Color::Black));}},
   Err(e)=>self.problem=Some(format!("Cannot faithfully encode {san}: {e}"))
  }
 }
 fn begin_variation(&mut self)->Skip {if self.problem.is_some(){return Skip(true);}let f=self.frames.last().unwrap();self.frames.push(Frame{position:f.before.clone().unwrap_or_else(||f.position.clone()),before:None});self.moves.push(encoding::VARIATION_START_MARKER);Skip(false)}
 fn end_variation(&mut self){if self.problem.is_some(){return;}if self.frames.len()<2{self.problem=Some("Unbalanced variation".into());return;}self.frames.pop();self.moves.push(encoding::VARIATION_END_MARKER);}
 fn comment(&mut self,c:RawComment<'_>){encoding::encode_comment(&String::from_utf8_lossy(c.as_bytes()),&mut self.moves);}
 fn nag(&mut self,n:Nag){encoding::encode_nag(&n.to_string(),&mut self.moves);}
 fn end_game(&mut self)->Self::Result {
  if let Some(e)=self.problem.take(){return Err(e);}if self.frames.len()!=1{return Err("Unbalanced game".into());}
  let p=&self.frames[0].position;
  let white=p.board().by_piece(shakmaty::Piece{color:Color::White,role:Role::Pawn}).0;
  let black=p.board().by_piece(shakmaty::Piece{color:Color::Black,role:Role::Pawn}).0;
  Ok(json!({"headers":self.headers,"moves":hex::encode(&self.moves),"plyCount":self.plies,"whiteMaterial":self.min_material[0],"blackMaterial":self.min_material[1],"pawnHome":((white>>8)&255)|(((black>>48)&255)<<8)}))
 }
}
fn request(v:Value)->Result<Value,String>{
 if let Some(pgn)=v.get("pgn").and_then(Value::as_str){
  let mut encoder=Encoder::default();let mut reader=BufferedReader::new(pgn.as_bytes());
  let game=reader.read_game(&mut encoder).map_err(|e|e.to_string())?.ok_or("No PGN game")??;
  if reader.read_game(&mut encoder).map_err(|e|e.to_string())?.is_some(){return Err("Expected one game".into());}return Ok(game);
 }
 let moves=hex::decode(v["moves"].as_str().ok_or("Missing moves")?).map_err(|e|e.to_string())?;
 let fen=v["fen"].as_str().unwrap_or("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");position(fen)?;
 let movetext=encoding::decode_game_to_movetext(&moves,Fen::from_ascii(fen.as_bytes()).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 Ok(json!({"movetext":movetext}))
}
fn main(){for line in io::stdin().lock().lines(){let result=line.map_err(|e|e.to_string()).and_then(|s|serde_json::from_str(&s).map_err(|e|e.to_string())).and_then(request);let response=match result{Ok(value)=>json!({"ok":true,"value":value}),Err(error)=>json!({"ok":false,"error":error})};println!("{response}");let _=io::stdout().flush();}}
