const { src, dest } = require('gulp');

/**
 * Copy SVG icon files from source directories to dist
 * so they are available when n8n loads the node.
 */
function buildIcons() {
	return src('nodes/**/*.svg').pipe(dest('dist/nodes/'));
}

exports['build:icons'] = buildIcons;
