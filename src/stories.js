// Guided starting points. Each one sets up the map and adds a short caption.
// Every figure here comes from the site's own data (checked when written);
// if the data is rebuilt, re-check them.

export const STORIES = [
  {
    id: 'empire',
    title: 'The end of empire',
    layer: 'decolonisation',
    year: 1960,
    text:
      'In 1960, the “Year of Africa”, newly independent states spoke most about ending colonial rule. ' +
      'The Republic of the Congo spent 71% of its speech on it. Worldwide it peaked at 21% in 1961 and fell to 3% by 2000.',
  },
  {
    id: 'nuclear',
    title: 'The nuclear age',
    layer: 'nuclear',
    year: 1962,
    text:
      'In the year of the Cuban Missile Crisis, nuclear weapons took up 15% of the average speech. ' +
      'Mexico (55%) and the Soviet Union (45%) talked about them most. By 2025 the share was 1.5%.',
  },
  {
    id: 'wall',
    title: 'When the Wall fell',
    layer: 'democracy',
    year: 1995,
    country: 'POL',
    details: true,
    text:
      'In 1985 Poland’s speech sounded most like Czechoslovakia’s, the Soviet Union’s and Hungary’s. ' +
      'By 1995 its closest matches were Lithuania, Slovenia and Sweden. Talk of democracy peaked worldwide in 1991.',
  },
  {
    id: 'terrorism',
    title: 'The day the agenda changed',
    layer: 'terrorism',
    year: 2001,
    text:
      'Terrorism took up 1.4% of the average speech in 2000. In 2001, weeks after the 9/11 attacks, ' +
      'it was 20.4%, the highest it has ever been.',
  },
  {
    id: 'climate',
    title: 'Climate moves to the centre',
    layer: 'climate',
    year: 2019,
    text:
      'Climate jumped from 3.7% of the average speech in 2006 to 14% in 2007, and peaked at 17% in 2019. ' +
      'That year Australia, Tonga and Fiji each spent more than two-thirds of their speech on it.',
  },
  {
    id: 'fiji',
    title: 'Small islands, big voice',
    layer: 'co2_pc',
    year: 2021,
    country: 'FJI',
    text:
      'Fiji spent 52% of its 2021 speech on climate, 3.6 times the world average, ' +
      'while emitting 1.5 tonnes of CO₂ per person, about 40% less than the median country.',
  },
];
