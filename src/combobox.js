// A text box for picking a country by typing, with a list of matches below it.
// Matching comes from search.js, so short, accented and former names all
// work: "UK", "cote", "USSR". Used by the map's "Find a country", the compare
// page's two pickers and the daily game's guesses.

// `input` and `list` are an <input> and an empty <ul> from the page; `find` is
// from makeSearch; `onChoose(iso)` is called with the chosen country.
//
// Two ways to use it:
// - a search box (the default) empties itself once a country is chosen;
// - a picker (pass `nameOf`) shows the chosen country's name, set with the
//   returned `set(iso)`, and puts it back if the reader leaves without choosing.
//
// `onOpen` runs when the list opens (the map closes its other pop-overs).
export function makeCombobox({ input, list, find, onChoose, nameOf = null, onOpen = () => {}, limit = 6 }) {
  const picker = Boolean(nameOf);
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
    matches = find(input.value, limit);
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
    onOpen();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight();
  }

  function choose(i) {
    const match = matches[i];
    if (!match) return;
    close();
    if (!picker) input.value = '';
    input.blur();
    onChoose(match.iso);
  }

  function set(iso) {
    current = iso;
    input.value = nameOf(iso);
  }

  input.addEventListener('focus', () => {
    // A picker selects the whole name, so typing replaces it.
    if (picker) input.select();
    else if (input.value.trim()) show();
  });
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
      // Escape only clears the box; it shouldn't also close what's behind it.
      e.stopPropagation();
      close();
      if (picker && current) {
        set(current);
        input.select();
      } else {
        input.value = '';
      }
    }
  });
  input.addEventListener('blur', () => {
    close();
    if (picker && current) set(current);
  });

  return { set, close };
}
