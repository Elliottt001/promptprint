/** Shared deterministic word placement with caller-supplied font measurement. */
function dominantSource(sources) {
  const entries = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "mixed";
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return "mixed";
  return entries[0][0];
}

function intersects(candidate, boxes, padding = 5) {
  return boxes.some((box) => !(
    candidate.x + candidate.width / 2 + padding < box.x - box.width / 2 ||
    candidate.x - candidate.width / 2 - padding > box.x + box.width / 2 ||
    candidate.y + candidate.height / 2 + padding < box.y - box.height / 2 ||
    candidate.y - candidate.height / 2 - padding > box.y + box.height / 2
  ));
}

export function layoutWords(words, width, height, measureText) {
  if (!words.length) return [];
  words = words.map(word => ({...word, filteredCount:word.filteredCount ?? word.count}));
  const max = words[0].filteredCount;
  const min = words.at(-1).filteredCount;
  const boxes = [];
  const placed = [];
  const safeWidth = width * 0.92;
  const safeHeight = height * 0.85;
  const radialStep = Math.max(3, Math.min(width, height) / 120);
  const horizontalStretch = Math.min(1.8, Math.max(1.2, width / height));

  words.forEach((word, wordIndex) => {
    const ratio = max === min ? 0.55 : (Math.log1p(word.filteredCount) - Math.log1p(min)) / (Math.log1p(max) - Math.log1p(min));
    const fontSize = Math.round(14 + ratio * Math.min(66, width / 15));
    const textWidth = Math.max(measureText(word.text, fontSize), fontSize);
    const box = { width: textWidth, height: fontSize * 1.05 };
    let match = null;

    for (let step = 0; step < 3200; step += 1) {
      const angle = step * 2.399963 + wordIndex * 0.47;
      const radius = radialStep * Math.sqrt(step);
      const candidate = {
        x: width / 2 + Math.cos(angle) * radius * horizontalStretch,
        y: height / 2 + Math.sin(angle) * radius,
        ...box,
      };
      if (
        candidate.x - box.width / 2 > (width - safeWidth) / 2 &&
        candidate.x + box.width / 2 < (width + safeWidth) / 2 &&
        candidate.y - box.height / 2 > (height - safeHeight) / 2 &&
        candidate.y + box.height / 2 < (height + safeHeight) / 2 &&
        !intersects(candidate, boxes, fontSize > 35 ? 8 : 4)
      ) {
        match = candidate;
        break;
      }
    }

    if (match) {
      boxes.push(match);
      placed.push({ ...word, ...match, fontSize, dominant: dominantSource(word.sources) });
    }
  });
  return placed;
}
