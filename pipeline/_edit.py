import io
def edit(p, pairs):
    s = io.open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, s.count(a), a[:60])
        s = s.replace(a, b)
    io.open(p, 'w', encoding='utf8', newline='').write(s)
