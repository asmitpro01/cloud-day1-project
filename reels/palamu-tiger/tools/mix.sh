#!/usr/bin/env bash
# Mix Hindi VO lines (placed per scene) over the music, duck the music under the voice, loudness-normalize.
set -euo pipefail
cd "$(dirname "$0")/.."
V=audio/vo; OUT=${1:-renders/mix.wav}
# start time (s) of each VO line
D=(0.20 3.40 7.45 12.15 17.65 22.55 26.35)
inputs=(); f=""
for i in 1 2 3 4 5 6 7; do inputs+=(-i "$V/vo${i}_hm_omega.wav"); ms=$(python3 -c "print(int(${D[$((i-1))]}*1000))"); f+="[$i:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms}|${ms},apad=whole_dur=30.5[v$i];"; done
f+="[v1][v2][v3][v4][v5][v6][v7]amix=inputs=7:normalize=0,atrim=0:30.5,highpass=f=80,equalizer=f=3000:t=q:w=1.2:g=2.5,acompressor=threshold=0.12:ratio=3:attack=5:release=120,loudnorm=I=-15:TP=-2:LRA=7,aformat=channel_layouts=stereo,asplit=2[vo][sc];"
f+="[0:a]aresample=48000,volume=0.30[mu];[mu][sc]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=450:makeup=1[duck];"
f+="[vo][duck]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000,atrim=0:30[out]"
ffmpeg -v error -y -i audio/music.wav "${inputs[@]}" -filter_complex "$f" -map "[out]" -ar 48000 -ac 2 "$OUT"
echo "mixed -> $OUT"
