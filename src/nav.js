// The menu bar at the top of every page. Pages built ahead of time
// (pipeline/build_profiles.mjs) call navHtml directly; the others put a
// <header class="site-nav" data-page="..."> in their HTML and call fillNav.

export const NAV = [
  ['map', 'Map', ''],
  ['countries', 'Countries', 'country/'],
  ['rankings', 'Rankings', 'rankings/'],
  ['compare', 'Compare', 'compare/'],
  ['daily', 'Puzzle', 'daily/'],
];

// `root` is the relative path back to the site's front page ("", "../", "../../").
export function navHtml(root, current) {
  const links = NAV.map(
    ([id, label, path]) =>
      `<a href="${root}${path}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');
  return `<a class="nav-brand" href="${root}">Atlas Meridian</a><nav class="nav-links" aria-label="Site">${links}</nav>`;
}

export function fillNav(root) {
  const header = document.querySelector('.site-nav');
  header.innerHTML = navHtml(root, header.dataset.page);
}
