/** Personal rules are applied to snapshots; this module never modifies source data. */
export const emptySettings = () => ({schemaVersion: 1, hiddenWords: [], aliasGroups: [], productLabels: {}});
export function normalizeTerm(text) {
  if (typeof text !== 'string' || !text.normalize('NFKC').trim()) throw new Error('词语不能为空');
  return text.normalize('NFKC').trim().toLowerCase();
}
const clone = value => JSON.parse(JSON.stringify(value));
export function normalizeSettings(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || value.schemaVersion !== 1)
    throw new Error('不支持的个人设置版本');
  const allowed = new Set(['schemaVersion', 'hiddenWords', 'aliasGroups', 'productLabels']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('设置文件包含未知字段');
  if (!Array.isArray(value.hiddenWords) || !Array.isArray(value.aliasGroups) ||
      !value.productLabels || Array.isArray(value.productLabels) || typeof value.productLabels !== 'object')
    throw new Error('个人设置结构无效');
  const owners = new Set();
  const aliasGroups = value.aliasGroups.map(group => {
    if (!group || Array.isArray(group) || typeof group !== 'object' || !Array.isArray(group.members) ||
        Object.keys(group).some(key => !['canonical', 'members'].includes(key))) throw new Error('词组结构无效');
    const canonical = normalizeTerm(group.canonical);
    const members = [...new Set([canonical, ...group.members.map(normalizeTerm)])].sort();
    if (members.length < 2) throw new Error('词组至少需要两个不同成员');
    for (const member of members) {
      if (owners.has(member)) throw new Error(`词组成员冲突：${member}`);
      owners.add(member);
    }
    return {canonical, members};
  }).sort((a, b) => a.canonical.localeCompare(b.canonical));
  const productLabels = Object.fromEntries(Object.entries(value.productLabels).map(([source, label]) => {
    if (!source.trim() || typeof label !== 'string' || [...label.trim()].length > 80) throw new Error('产品标签无效或超过 80 字符');
    return [source, label.trim()];
  }).filter(([, label]) => label));
  return {schemaVersion: 1, hiddenWords: [...new Set(value.hiddenWords.map(normalizeTerm))].sort(), aliasGroups, productLabels};
}
export function changeSettings(settings, action) {
  const next = normalizeSettings(settings);
  const members = word => {
    const term = normalizeTerm(word);
    return next.aliasGroups.find(group => group.members.includes(term))?.members ?? [term];
  };
  switch (action.type) {
    case 'hide': next.hiddenWords.push(...members(action.word)); break;
    case 'restore': {
      const restoring = new Set(members(action.word));
      next.hiddenWords = next.hiddenWords.filter(word => !restoring.has(word)); break;
    }
    case 'restoreAllHidden': next.hiddenWords = []; break;
    case 'putAlias': {
      const canonical = normalizeTerm(action.canonical);
      next.aliasGroups = next.aliasGroups.filter(group => group.canonical !== canonical);
      next.aliasGroups.push({canonical, members: action.members}); break;
    }
    case 'removeAlias': next.aliasGroups = next.aliasGroups.filter(group => group.canonical !== normalizeTerm(action.canonical)); break;
    case 'label': next.productLabels = {...next.productLabels, [action.source]: action.label}; break;
    case 'reset': return emptySettings();
    default: throw new Error('未知的个人设置操作');
  }
  return normalizeSettings(next);
}
export function createSettingsStore(storage, key = 'lingua-orbit.settings.v1') {
  let current = emptySettings(), previous = null, lastError = null;
  try {
    const saved = storage.getItem(key);
    if (saved !== null) current = normalizeSettings(JSON.parse(saved));
  } catch (error) { lastError = `无法恢复个人设置：${error.message}`; }
  function save() {
    let persisted = true;
    try { storage.setItem(key, JSON.stringify(current)); lastError = null; }
    catch (error) { persisted = false; lastError = `未保存：${error.message}；可导出个人设置。`; }
    return {settings: clone(current), persisted, error: lastError};
  }
  return {
    get: () => clone(current), error: () => lastError, canUndo: () => previous !== null,
    replace(value) { const normalized = normalizeSettings(value); previous = current; current = normalized; return save(); },
    undo() { if (previous !== null) { current = previous; previous = null; return save(); } return {settings: clone(current), persisted: !lastError, error: lastError}; },
    serialize: () => JSON.stringify(current, null, 2),
  };
}
