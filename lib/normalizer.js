const picomatch = require("picomatch");

const BANG = '!';
const negated = (str) => str.charAt(0) === BANG;

function normalizeFilter(filter) {
  if (filter === undefined) return;
  if (typeof filter === "function") return filter;

  if (typeof filter === "string") {
    const glob = picomatch(filter.trim());
    return (entry) => glob(entry.basename);
  }

  if (Array.isArray(filter)) {
    const positive = [];
    const negative = [];
    for (const item of filter) {
      const trimmed = item.trim();
      if (negated(trimmed)) {
        negative.push(picomatch(trimmed.slice(1)));
      } else {
        positive.push(picomatch(trimmed));
      }
    }

    if (negative.length) {
      if (positive.length) {
        return (entry) => positive.some(f => f(entry.basename)) &&
          !negative.every(f => f(entry.basename));
      } else {
        return (entry) => !negative.every(f => f(entry.basename));
      }
    } else {
      return (entry) => positive.some(f => f(entry.basename));
    }
  }
}

module.exports = normalizeFilter;
