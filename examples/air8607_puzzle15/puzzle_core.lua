--[[
@module  puzzle_core
@summary 数字华容道（15 Puzzle）纯逻辑，不依赖 AirUI，可在 PC 上单独测试
@note    棋盘用一维数组表示：tiles[i] 为格子里的数字，0 表示空格；下标从 1 开始。
]]
local M = {}

M.N = 4

function M.new(n)
    n = n or M.N
    local state = { n = n, tiles = {}, blank = n * n, moves = 0 }
    M.reset(state)
    return state
end

function M.reset(state)
    local last = state.n * state.n
    for i = 1, last - 1 do
        state.tiles[i] = i
    end
    state.tiles[last] = 0
    state.blank = last
    state.moves = 0
    return state
end

function M.neighbors(state, idx)
    local n = state.n
    local row = math.floor((idx - 1) / n) + 1
    local col = (idx - 1) % n + 1
    local out = {}
    if row > 1 then out[#out + 1] = idx - n end
    if row < n then out[#out + 1] = idx + n end
    if col > 1 then out[#out + 1] = idx - 1 end
    if col < n then out[#out + 1] = idx + 1 end
    return out
end

function M.can_move(state, idx)
    local last = state.n * state.n
    if type(idx) ~= "number" or idx < 1 or idx > last or idx == state.blank then
        return false
    end
    local nb = M.neighbors(state, idx)
    for i = 1, #nb do
        if nb[i] == state.blank then return true end
    end
    return false
end

function M.move(state, idx)
    if not M.can_move(state, idx) then return false end
    local blank = state.blank
    state.tiles[blank], state.tiles[idx] = state.tiles[idx], state.tiles[blank]
    state.blank = idx
    state.moves = state.moves + 1
    return true
end

function M.is_solved(state)
    local last = state.n * state.n
    for i = 1, last - 1 do
        if state.tiles[i] ~= i then return false end
    end
    return state.tiles[last] == 0
end

function M.manhattan(state)
    local n = state.n
    local dist = 0
    for i = 1, n * n do
        local v = state.tiles[i]
        if v ~= 0 then
            local row = math.floor((i - 1) / n) + 1
            local col = (i - 1) % n + 1
            local tr = math.floor((v - 1) / n) + 1
            local tc = (v - 1) % n + 1
            dist = dist + math.abs(row - tr) + math.abs(col - tc)
        end
    end
    return dist
end

function M.inversions(state)
    local inv = 0
    local last = state.n * state.n
    for i = 1, last - 1 do
        if state.tiles[i] ~= 0 then
            for j = i + 1, last do
                if state.tiles[j] ~= 0 and state.tiles[i] > state.tiles[j] then
                    inv = inv + 1
                end
            end
        end
    end
    return inv
end

--[[偶数阶棋盘：逆序数 + 空格所在行（从底部数）为奇数时可解；奇数阶只需逆序数为偶数。]]
function M.is_solvable(state)
    local n = state.n
    local inv = M.inversions(state)
    if n % 2 == 1 then
        return inv % 2 == 0
    end
    local blank_row_from_bottom = n - math.floor((state.blank - 1) / n)
    return (inv + blank_row_from_bottom) % 2 == 1
end

--[[从复原状态出发随机走合法步，保证生成的一定可解；并过滤掉太简单的局面。]]
function M.shuffle(state, opts)
    opts = opts or {}
    local rng = opts.rng or math.random
    local n = state.n
    local steps = opts.steps or n * n * 20
    local min_dist = opts.min_dist or (n >= 4 and 40 or 0)
    local attempts = 0
    repeat
        M.reset(state)
        local last = 0
        for _ = 1, steps do
            local nb = M.neighbors(state, state.blank)
            local pick
            repeat
                pick = nb[rng(#nb)]
            until pick ~= last
            state.tiles[state.blank], state.tiles[pick] = state.tiles[pick], state.tiles[state.blank]
            last, state.blank = state.blank, pick
        end
        state.moves = 0
        attempts = attempts + 1
    until (not M.is_solved(state) and M.manhattan(state) >= min_dist) or attempts >= 20
    return state
end

return M
