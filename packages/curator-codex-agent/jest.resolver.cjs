// Sources use NodeNext-style `./x.js` specifiers. Resolve them to the .ts sources,
// but only for our own files — never for node_modules.
module.exports = (request, options) => {
    if (/^\.{1,2}\//.test(request) && request.endsWith('.js') && !options.basedir.includes('node_modules')) {
        try {
            return options.defaultResolver(request.slice(0, -3), options);
        } catch { /* fall through to the default resolution */ }
    }
    return options.defaultResolver(request, options);
};
