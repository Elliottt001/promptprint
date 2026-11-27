/** Shared deterministic word placement with caller-supplied font measurement. */
function dominantSource(sources) {
  const entries = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "mixed";
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return "mixed";
  return entries[0][0];
}

function intersects(candidate, boxes, padding = 5) {
  return boxes.some(
    (box) =>
      !(
        candidate.x + candidate.width / 2 + padding < box.x - box.width / 2 ||
        candidate.x - candidate.width / 2 - padding > box.x + box.width / 2 ||
        candidate.y + candidate.height / 2 + padding < box.y - box.height / 2 ||
        candidate.y - candidate.height / 2 - padding > box.y + box.height / 2
      ),
  );
}

export function layoutWords(words, width, height, measureText) {
  if (!words.length) return [];
  words = words.map((word) => ({
    ...word,
    filteredCount: word.filteredCount ?? word.count,
  }));
  const max = words[0].filteredCount;
  const min = words.at(-1).filteredCount;
  const boxes = [];
  const placed = [];
  const safeWidth = width * 0.92;
  const safeHeight = height * 0.85;
  const radialStep = Math.max(3, Math.min(width, height) / 120);
  const horizontalStretch = Math.min(1.8, Math.max(1.2, width / height));

  words.forEach((word, wordIndex) => {
    const ratio =
      max === min
        ? 0.55
        : (Math.log1p(word.filteredCount) - Math.log1p(min)) /
          (Math.log1p(max) - Math.log1p(min));
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
      placed.push({
        ...word,
        ...match,
        fontSize,
        dominant: dominantSource(word.sources),
      });
    }
  });
  return placed;
}

// Rank-based seats come from the approved B composition, never from business records.
const FIELD_SEATS = [
  [36, 39, 88],
  [57, 47, 76],
  [24, 62, 64],
  [45, 61, 68],
  [73, 62, 56],
  [60, 28, 47],
  [23, 34, 52],
  [71, 38, 46],
  [43, 22, 39],
  [47, 80, 42],
  [61, 76, 38],
  [17, 46, 32],
  [73, 23, 30],
  [84, 47, 30],
  [32, 80, 32],
  [31, 20, 27],
  [78, 77, 29],
  [17, 76, 25],
  [59, 91, 24],
  [14, 23, 22],
  [86, 31, 23],
  [87, 67, 23],
  [40, 91, 23],
  [8, 60, 22],
];

export function layoutField(
  words,
  width,
  height,
  measureText,
  { fontScale = 1 } = {},
) {
  const boxes = [],
    placed = [];
  const scale = Math.min(1, width / (width < 600 ? 728 : 1120)),
    padding = width < 600 ? 2 : 5;
  words.forEach((word, index) => {
    const seat = FIELD_SEATS[index];
    const size = seat ? seat[2] : Math.max(14, 22 - (index - 24) * 0.15);
    let fontSize = Math.max(14, Math.round(size * scale * fontScale));
    let box, match;
    // Long terms fit their measured bounds; the fallback preserves arbitrary input.
    while (fontSize >= 14) {
      box = {
        width: Math.max(measureText(word.text, fontSize), fontSize),
        height: fontSize * 1.05,
      };
      const center = {
        x: ((seat?.[0] ?? 50) * width) / 100,
        y: ((seat?.[1] ?? 50) * height) / 100,
      };
      for (let step = 0; step < 2400; step++) {
        const angle = step * 2.399963 + index * 0.47,
          radius = step ? Math.sqrt(step) * Math.max(2, width / 400) : 0;
        const candidate = {
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius,
          ...box,
        };
        if (
          candidate.x - box.width / 2 >= padding &&
          candidate.x + box.width / 2 <= width - padding &&
          candidate.y - box.height / 2 >= padding &&
          candidate.y + box.height / 2 <= height - padding &&
          !intersects(candidate, boxes, padding)
        ) {
          match = candidate;
          break;
        }
      }
      if (match) break;
      if (fontSize === 14) break;
      fontSize = Math.max(14, fontSize - 2);
    }
    if (match) {
      boxes.push(match);
      placed.push({
        ...word,
        ...match,
        fontSize,
        filteredCount: word.filteredCount ?? word.count,
        dominant: dominantSource(word.sources),
        rank: index,
      });
    }
  });
  return placed;
}
