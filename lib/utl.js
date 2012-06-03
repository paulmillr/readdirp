Array.prototype.unique = function () {
  var o = {},
        i, 
        l = this.length,
        r = [];

    for (i = 0; i < l; i += 1) o[this[i]] = this[i];
    for (i in o) r.push(o[i]);
    return r;
};

Array.prototype.contains = function (elem) {
    return this.indexOf(elem) > -1;
};

module.exports.isFunction = function (obj) {
    return toString.call(obj) == '[object Function]';
};

module.exports.isString = function (obj) {
    return toString.call(obj) == '[object String]';
};

module.exports.isRegExp = function(obj) {
    return toString.call(obj) == '[object RegExp]';
};

module.exports.isUndefined = function(obj) {
    return obj === void 0;
};
