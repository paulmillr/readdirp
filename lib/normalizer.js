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
    const trimmed = filter.map(f => f.trim());
    const positive = filter.filter(f => !negated(f)).map(f => picomatch(f));
    const negative = filter.filter(f => negated(f)).map(f => picomatch(f.slice(1)));

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
