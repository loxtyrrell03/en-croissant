"""Check a legal certificate and the alternative on the recorded move history."""

import chess

from sample import forced_two, verify_start, wins_next


def initial(item):
    if not item.get("history"):
        return chess.Board(item["fen"])
    history = item["history"]
    board = chess.Board(history["fen"])
    for uci in history["moves"]:
        board.push_uci(uci)
    assert board.fen() == chess.Board(item["fen"]).fen(), item["id"]
    return board


def verify(item, consequence):
    board = initial(item)
    played, attack, reply, mate = consequence["lineUci"]
    safe = consequence["avoidingMoveUci"]
    assert played == item["playedMoveUci"] and safe != played, item["id"]
    after = board.copy()
    after.push_uci(played)
    assert not wins_next(after), item["id"]
    assert not after.is_game_over(), item["id"]
    attacking_move = after.parse_uci(attack)
    checking = after.gives_check(attacking_move)
    replies = verify_start(after, attacking_move)
    assert replies, item["id"]
    for uci in (attack, reply, mate):
        after.push_uci(uci)
    assert after.is_checkmate(), item["id"]

    stronger = board.copy()
    stronger.push_uci(safe)
    assert not wins_next(stronger) and not forced_two(stronger), item["id"]
    detail = consequence.get("avoidingLineUci")
    if detail:
        assert len(detail) == 3 and detail[:2] == [safe, attack], item["id"]
        counter = board.copy()
        for uci in detail:
            counter.push_uci(uci)
        assert not wins_next(counter), item["id"]
    return dict(
        played=board.variation_san(map(chess.Move.from_uci, (played, attack, reply, mate))),
        alternative=board.variation_san(map(chess.Move.from_uci, detail or [safe])),
        attackIsCheck=checking,
        defencesChecked=len(replies),
        explanation=consequence["explanation"],
    )
