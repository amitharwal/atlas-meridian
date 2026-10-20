// A text box for picking a country by typing, with a list of matches below it
// (the compare page's two pickers). Matching comes from search.js, so short,
// accented and former names all work: "UK", "cote", "USSR".

// `input` and `list` are an <input> and an empty <ul> from the page; `find` is
// from makeSearch. Returns `set(iso)`, which shows the chosen country's name.
export function makeCombobox({ input, list, find, nameOf, onChoose }) {
  let current = null;
  let matches = [];
  let active = 0;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.autocomplete = 'off';
  input.spellcheck = false;
  list.setAttribute('role', 'listbox');

  const optionId = (iso) => `${list.id}-${iso}`;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function highlight() {
    [...list.querySelectorAll('[role="option"]')].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
    if (matches[active]) input.setAttribute('aria-activedescendant', optionId(matches[active].iso));
  }

  function show() {
    matches = find(input.value, 8);
    active = 0;
    if (!input.value.trim()) return close();
    list.replaceChildren(
      ...(matches.length
        ? matches.map((match, i) => {
            const option = document.createElement('li');
            option.id = optionId(match.iso);
            option.className = 'pick-option';
            option.setAttribute('role', 'option');
            const name = document.createElement('span');
            name.textContent = match.name;
            option.append(name);
            if (match.former.length) {
              const alt = document.createElement('span');
              alt.className = 'pick-alt';
              alt.textContent = `was ${match.former.join(', ')}`;
              option.append(alt);
            }
            // pointerdown, not click, so it fires before the box loses focus.
            option.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              choose(i);
            });
            return option;
          })
        : [Object.assign(document.createElement('li'), { className: 'pick-empty', textContent: 'No country by that name' })]),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight();
  }

  function choose(i) {
    const match = matches[i];
    if (!match) return;
    close();
    input.blur();
    onChoose(match.iso);
  }

  function set(iso) {
    current = iso;
    input.value = nameOf(iso);
  }

  // Clicking in selects the whole name, so typing replaces it.
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', show);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return show();
      if (!matches.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      close();
      set(current);
      input.select();
    }
  });
  // Leaving without choosing puts the current country's name back.
  input.addEventListener('blur', () => {
    close();
    if (current) set(current);
  });

  return { set };
}
