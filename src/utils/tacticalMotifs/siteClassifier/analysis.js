/**
 * DOM-free compatibility export for the vendored site tactical classifier.
 *
 * ChessLite is copied from public/js/services/analysis.js in Chess Mistake Trainer.
 * Keep this file limited to the ChessLite function: the original module also owns
 * browser UI, storage, and network behavior that does not belong in En Croissant.
 */

    function ChessLite(){

      const FILES='abcdefgh';

      let board = new Array(64).fill(null);

      let side='w';

      let castling={K:true,Q:true,k:true,q:true};

      let ep=-1, halfmove=0, fullmove=1;



      function idx(file, rank){ return (7-(rank-1))*8+file; }

      function sqToIdx(sq){ const f=FILES.indexOf(sq[0]); const r=parseInt(sq[1],10); return idx(f,r); }

      function idxToSq(i){ const r=8-Math.floor(i/8); const f=i%8; return FILES[f]+r; }

      function pieceColor(pc){ return pc===pc?.toUpperCase()?'w':'b'; }

      function reset(){ loadFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); }

      function loadFEN(f){

        board.fill(null);

        const parts=f.trim().split(/\s+/);

        const rows=parts[0].split('/');

        for(let r=0;r<8;r++){

          let file=0;

          for(const ch of rows[r]){

            if(/[1-8]/.test(ch)) file+=parseInt(ch,10);

            else{ board[r*8+file]=ch; file++; }

          }

        }

        side=parts[1]||'w';

        castling={K:false,Q:false,k:false,q:false};

        if(parts[2]&&parts[2]!=='-'){ for(const c of parts[2]) if(castling.hasOwnProperty(c)) castling[c]=true; }

        ep=(parts[3]&&parts[3]!=='-')?sqToIdx(parts[3]):-1;

        halfmove=parts[4]?parseInt(parts[4],10):0;

        fullmove=parts[5]?parseInt(parts[5],10):1;

        return true;

      }

      function fen(){

        let s='';

        for(let r=0;r<8;r++){

          let empty=0;

          for(let f=0;f<8;f++){

            const p=board[r*8+f];

            if(!p) empty++;

            else{ if(empty){s+=empty;empty=0;} s+=p; }

          }

          if(empty) s+=empty;

          if(r<7) s+='/';

        }

        s+=' '+side+' ';

        let cstr=''; if(castling.K)cstr+='K'; if(castling.Q)cstr+='Q'; if(castling.k)cstr+='k'; if(castling.q)cstr+='q';

        s+=(cstr||'-');

        s+=' '+(ep>=0?idxToSq(ep):'-');

        s+=' '+halfmove+' '+fullmove;

        return s;

      }

      function rcOf(i){ return { r:Math.floor(i/8), c:i%8 }; }

      function inBounds(r,c){ return r>=0&&r<8&&c>=0&&c<8; }

      function kingIndex(color){ const K=(color==='w')?'K':'k'; for(let i=0;i<64;i++) if(board[i]===K) return i; return -1; }

      function squareAttacked(i, by){

        const {r,c}=rcOf(i);

        // pawns

        if(by==='w'){ const rr=r+1; if(inBounds(rr,c-1)&&board[rr*8+c-1]==='P')return true; if(inBounds(rr,c+1)&&board[rr*8+c+1]==='P')return true;}

        else{ const rr=r-1; if(inBounds(rr,c-1)&&board[rr*8+c-1]==='p')return true; if(inBounds(rr,c+1)&&board[rr*8+c+1]==='p')return true;}

        // knights

        const nn=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

        for(const [dr,dc] of nn){ const rr=r+dr,cc=c+dc; if(!inBounds(rr,cc))continue; const p=board[rr*8+cc]; if(p && ((by==='w'&&p==='N')||(by==='b'&&p==='n'))) return true; }

        // bishops/queens

        const di=[[-1,-1],[-1,1],[1,-1],[1,1]];

        for(const [dr,dc] of di){ let rr=r+dr,cc=c+dc; while(inBounds(rr,cc)){ const p=board[rr*8+cc]; if(p){ if((by==='w'&&('BQ'.includes(p)))||(by==='b'&&('bq'.includes(p)))) return true; break;} rr+=dr; cc+=dc; } }

        // rooks/queens

        const or=[[-1,0],[1,0],[0,-1],[0,1]];

        for(const [dr,dc] of or){ let rr=r+dr,cc=c+dc; while(inBounds(rr,cc)){ const p=board[rr*8+cc]; if(p){ if((by==='w'&&('RQ'.includes(p)))||(by==='b'&&('rq'.includes(p)))) return true; break;} rr+=dr; cc+=dc; } }

        // king

        for(let dr=-1;dr<=1;dr++){ for(let dc=-1;dc<=1;dc++){ if(dr===0&&dc===0)continue; const rr=r+dr,cc=c+dc; if(!inBounds(rr,cc))continue; const p=board[rr*8+cc]; if(p && ((by==='w'&&p==='K')||(by==='b'&&p==='k'))) return true; } }

        return false;

      }

      function inCheck(color){ const ki=kingIndex(color); return squareAttacked(ki, color==='w'?'b':'w'); }



      function clone(){ return { board:board.slice(), side, castling:{...castling}, ep, halfmove, fullmove }; }

      function restore(s){ board=s.board.slice(); side=s.side; castling={...s.castling}; ep=s.ep; halfmove=s.halfmove; fullmove=s.fullmove; }



      function makeMove(from, to, promotion){

        const prev=clone();

        const p=board[from];

        const pc=pieceColor(p);

        const cap=board[to];



        // en passant capture

        if((p==='P'||p==='p')){

          const {r:rf,c:cf}=rcOf(from); const {r:rt,c:ct}=rcOf(to);

          if(cf!==ct && !cap){ const capIdx = pc==='w' ? to+8 : to-8; board[capIdx]=null; }

        }

        // move piece

        board[to]=board[from]; board[from]=null;



        // promotion

        if(promotion){ board[to] = (pc==='w'?promotion.toUpperCase():promotion.toLowerCase()); }



        // castling rook move

        if(p==='K' && Math.abs(rcOf(to).c - rcOf(from).c)===2){

          if(rcOf(to).c===6){ board[sqToIdx('f1')]='R'; board[sqToIdx('h1')]=null; }

          else { board[sqToIdx('d1')]='R'; board[sqToIdx('a1')]=null; }

          castling.K=false; castling.Q=false;

        }

        if(p==='k' && Math.abs(rcOf(to).c - rcOf(from).c)===2){

          if(rcOf(to).c===6){ board[sqToIdx('f8')]='r'; board[sqToIdx('h8')]=null; }

          else { board[sqToIdx('d8')]='r'; board[sqToIdx('a8')]=null; }

          castling.k=false; castling.q=false;

        }



        // update ep

        ep=-1;

        if(p==='P' || p==='p'){

          const {r:rf}=rcOf(from); const {r:rt}=rcOf(to);

          if(Math.abs(rt-rf)===2) ep = pc==='w' ? (to+8) : (to-8);

        }



        // castling rights

        const fromSq=idxToSq(from), toSq=idxToSq(to);

        if(p==='K'){ castling.K=false; castling.Q=false; }

        if(p==='k'){ castling.k=false; castling.q=false; }

        if(fromSq==='h1'||toSq==='h1') castling.K=false;

        if(fromSq==='a1'||toSq==='a1') castling.Q=false;

        if(fromSq==='h8'||toSq==='h8') castling.k=false;

        if(fromSq==='a8'||toSq==='a8') castling.q=false;



        if((p==='P'||p==='p') || cap) halfmove=0; else halfmove++;

        if(side==='b') fullmove++;

        side = side==='w'?'b':'w';



        return prev;

      }



      function generate(){

        const moves=[];

        const us=side, them=side==='w'?'b':'w';

        for(let i=0;i<64;i++){

          const p=board[i]; if(!p||pieceColor(p)!==us) continue;

          const {r,c}=rcOf(i);



          const add=(from,to,promotion)=>{

            // Determine captured piece (including en passant) on the current board state

            let captured=null;

            const targetPiece = board[to];

            if(targetPiece && pieceColor(targetPiece)===them){

              captured = targetPiece;

            } else {

              // En passant: pawn moves diagonally to empty square equal to ep target

              if((p==='P'||p==='p') && to===ep && !targetPiece){

                captured = (us==='w') ? 'p' : 'P';

              }

            }

            const prev=clone(); makeMove(from,to,promotion);

            const legal=!inCheck(us); restore(prev);

            if(legal){ moves.push({from, to, promotion:promotion||null, piece:p, captured}); }

          };



          if(p==='P'||p==='p'){

            const forward=(us==='w')?-1:1; const start=(us==='w')?6:1; const promo=(us==='w')?0:7;

            const oneR=r+forward;

            if(inBounds(oneR,c) && !board[oneR*8+c]){

              if(oneR===promo){ for(const pr of ['q','r','b','n']) add(i, oneR*8+c, pr); }

              else add(i, oneR*8+c);

              const twoR=r+2*forward;

              if(r===start && !board[twoR*8+c]) add(i, twoR*8+c);

            }

            for(const dc of [-1,1]){

              const rr=r+forward, cc=c+dc; if(!inBounds(rr,cc)) continue;

              const t=rr*8+cc;

              if(board[t] && pieceColor(board[t])===them){

                if(rr===promo){ for(const pr of ['q','r','b','n']) add(i,t,pr); }

                else add(i,t);

              }else if(t===ep){ add(i,t); }

            }

          }else if(p==='N'||p==='n'){

            const NN=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

            for(const [dr,dc] of NN){ const rr=r+dr,cc=c+dc; if(!inBounds(rr,cc)) continue; const t=rr*8+cc; if(!board[t]||pieceColor(board[t])!==us) add(i,t); }

          }else if(p==='B'||p==='b'){

            const D=[[-1,-1],[-1,1],[1,-1],[1,1]];

            for(const [dr,dc] of D){ let rr=r+dr,cc=c+dc; while(inBounds(rr,cc)){ const t=rr*8+cc; if(board[t]){ if(pieceColor(board[t])!==us) add(i,t); break; } add(i,t); rr+=dr; cc+=dc; } }

          }else if(p==='R'||p==='r'){

            const D=[[-1,0],[1,0],[0,-1],[0,1]];

            for(const [dr,dc] of D){ let rr=r+dr,cc=c+dc; while(inBounds(rr,cc)){ const t=rr*8+cc; if(board[t]){ if(pieceColor(board[t])!==us) add(i,t); break; } add(i,t); rr+=dr; cc+=dc; } }

          }else if(p==='Q'||p==='q'){

            const D=[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];

            for(const [dr,dc] of D){ let rr=r+dr,cc=c+dc; while(inBounds(rr,cc)){ const t=rr*8+cc; if(board[t]){ if(pieceColor(board[t])!==us) add(i,t); break; } add(i,t); rr+=dr; cc+=dc; } }

          }else if(p==='K'||p==='k'){

            for(let dr=-1;dr<=1;dr++){ for(let dc=-1;dc<=1;dc++){ if(dr===0&&dc===0)continue; const rr=r+dr,cc=c+dc; if(!inBounds(rr,cc))continue; const t=rr*8+cc; if(!board[t]||pieceColor(board[t])!==us) add(i,t); } }

            if(us==='w' && r===7 && c===4){

              if(castling.K && !board[sqToIdx('f1')] && !board[sqToIdx('g1')] && !inCheck('w') && !squareAttacked(sqToIdx('f1'),'b') && !squareAttacked(sqToIdx('g1'),'b')) add(i,sqToIdx('g1'));

              if(castling.Q && !board[sqToIdx('d1')] && !board[sqToIdx('c1')] && !board[sqToIdx('b1')] && !inCheck('w') && !squareAttacked(sqToIdx('d1'),'b') && !squareAttacked(sqToIdx('c1'),'b')) add(i,sqToIdx('c1'));

            }

            if(us==='b' && r===0 && c===4){

              if(castling.k && !board[sqToIdx('f8')] && !board[sqToIdx('g8')] && !inCheck('b') && !squareAttacked(sqToIdx('f8'),'w') && !squareAttacked(sqToIdx('g8'),'w')) add(i,sqToIdx('g8'));

              if(castling.q && !board[sqToIdx('d8')] && !board[sqToIdx('c8')] && !board[sqToIdx('b8')] && !inCheck('b') && !squareAttacked(sqToIdx('d8'),'w') && !squareAttacked(sqToIdx('c8'),'w')) add(i,sqToIdx('c8'));

            }

          }

        }

        return moves.map(m=>({

          from: idxToSq(m.from), to: idxToSq(m.to),

          uci: idxToSq(m.from)+idxToSq(m.to)+(m.promotion?m.promotion:''),

          piece: m.piece, promotion: m.promotion||null,

          captured: m.captured

        }));

      }



      function moveUci(uci){

        const from = sqToIdx(uci.slice(0,2)), to = sqToIdx(uci.slice(2,4));

        const promo = uci.length>4 ? uci[4] : null;

        const legal = generate().filter(m => m.uci === (uci));

        if(legal.length){

          const prev = makeMove(from,to,promo);

          return {ok:true, prev};

        }

        return {ok:false};

      }



      function parseSANtoMove(san){

        san=san.trim();

        if(/^O-O-O|^0-0-0/.test(san)){ return (side==='w'?'e1c1':'e8c8'); }

        if(/^O-O|^0-0/.test(san)){ return (side==='w'?'e1g1':'e8g8'); }

        san = san.replace(/[+#]|!!|\?\?|!\?|\?!/g, '');

        let promo=null; const pm=san.match(/=([NBRQ])/); if(pm){ promo=pm[1].toLowerCase(); san=san.replace(/=([NBRQ])/, ''); }

        const dm=san.match(/([a-h][1-8])$/); if(!dm) return null; const dest=dm[1]; san=san.slice(0, san.length-dest.length);

        let pieceLetter='P'; if(/^[NBRQK]/.test(san)){ pieceLetter=san[0]; san=san.slice(1); }

        san=san.replace('x','');

        let disFile=null, disRank=null;

        if(san.length===2){ if(/[a-h]/.test(san[0]))disFile=san[0]; if(/[1-8]/.test(san[0]))disRank=san[0]; if(/[a-h]/.test(san[1]))disFile=san[1]; if(/[1-8]/.test(san[1]))disRank=san[1]; }

        else if(san.length===1){ if(/[a-h]/.test(san))disFile=san; if(/[1-8]/.test(san))disRank=san; }



        const legal=generate().filter(m=>m.to===dest).filter(m=>{

          const want=pieceLetter; const isPawn=want==='P';

          const okPiece = isPawn ? /[Pp]/.test(m.piece) :

            (want==='N'?/[Nn]/.test(m.piece): want==='B'?/[Bb]/.test(m.piece):

             want==='R'?/[Rr]/.test(m.piece): want==='Q'?/[Qq]/.test(m.piece): /[Kk]/.test(m.piece));

          if(!okPiece) return false;

          if(disFile && m.from[0]!==disFile) return false;

          if(disRank && m.from[1]!==disRank) return false;

          if(promo && m.promotion!==promo) return false;

          return true;

        });

        return (legal[0] && legal[0].uci) || null;

      }



      function loadPGN(pgn){

        const text = (pgn||'').replace(/\r/g,'').replace(/\[(.|\n)*?\]\s*/g,' ').trim();

        const tokens=[]; let i=0;

        while(i<text.length){

          const ch=text[i];

          if(ch==='{' ){ let j=i+1; while(j<text.length&&text[j]!=='}') j++; tokens.push({type:'comment', value:text.slice(i+1,j)}); i=j+1; continue; }

          if(/\s/.test(ch)){ i++; continue; }

          const num=text.slice(i).match(/^\d+\.(\.\.)?/); if(num){ i+=num[0].length; continue; }

          const res=text.slice(i).match(/^(1-0|0-1|1\/2-1\/2|\*)/); if(res){ i+=res[0].length; continue; }

          const nag=text.slice(i).match(/^\$\d+/); if(nag){ i+=nag[0].length; continue; }

          let j=i; while(j<text.length && !/\s|\{/.test(text[j])) j++;

          tokens.push({type:'san', value:text.slice(i,j)}); i=j;

        }

        reset();

        const moves=[];

        for(const t of tokens){

          if(t.type==='san'){

            const uci=parseSANtoMove(t.value);

            if(!uci) continue;

            const mv=moveUci(uci);

            if(!mv.ok) continue;

            moves.push({uci, san:t.value, fenAfter:fen()});

          }else{

            moves.push({comment:t.value});

          }

        }

        return moves;

      }



      return {

        reset, loadFEN, fen, turn:()=>side,

        moves: generate, moveUci, parseSANtoMove, loadPGN,

        idxToSq, sqToIdx, inCheck

      }

    }

export { ChessLite };
