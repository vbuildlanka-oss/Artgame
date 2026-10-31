// Word bank. Entries are "word/alias/alias": any alias counts as correct.

export const LEVELS = {
  1: { name: 'Easy', emoji: '🍎' },
  2: { name: 'Medium', emoji: '🎸' },
  3: { name: 'Tricky', emoji: '🦒' },
};

const WORDS = {
  1: {
    Animal: ['cat/kitty/kitten', 'dog/puppy/doggy', 'fish', 'snake', 'bird', 'pig/piggy', 'duck', 'snail', 'bee/bumblebee', 'mouse', 'frog', 'worm', 'ladybug/ladybird'],
    Food: ['apple', 'banana', 'pizza', 'ice cream/icecream/ice cream cone', 'egg', 'cake', 'carrot', 'cookie/biscuit', 'donut/doughnut', 'cherry/cherries', 'grapes/grape', 'lemon'],
    Nature: ['sun', 'moon', 'star', 'tree', 'flower', 'cloud', 'rain', 'mountain/mountains', 'leaf', 'rainbow', 'fire/flame'],
    Thing: ['house/home', 'car', 'ball', 'cup/mug', 'key', 'book', 'hat', 'shoe', 'chair', 'clock', 'umbrella', 'glasses/spectacles', 'door', 'bed', 'boat/ship', 'balloon', 'phone/mobile/cellphone/smartphone', 'pencil'],
    'Love 💕': ['heart', 'ring', 'gift/present', 'lips/kiss', 'smile/smiley/happy face'],
  },
  2: {
    Animal: ['giraffe', 'elephant', 'octopus', 'turtle/tortoise', 'butterfly', 'penguin', 'crab', 'owl', 'whale', 'rabbit/bunny', 'shark', 'bat', 'cow', 'horse', 'monkey', 'lion'],
    Food: ['burger/hamburger/cheeseburger', 'hot dog/hotdog', 'popcorn', 'watermelon', 'taco', 'sushi', 'pineapple', 'cupcake/muffin', 'french fries/fries/chips', 'lollipop/candy/sucker', 'cheese', 'pancakes/pancake'],
    Nature: ['volcano', 'cactus', 'snowman', 'island', 'lightning/thunder/thunderstorm', 'mushroom', 'campfire/bonfire', 'beach'],
    Thing: ['guitar', 'bicycle/bike', 'rocket/spaceship/rocketship', 'robot', 'camera', 'lighthouse', 'kite', 'castle', 'tent', 'sailboat', 'airplane/plane/aeroplane', 'scissors', 'candle', 'toothbrush', 'headphones/earphones', 'sunglasses/shades', 'crown', 'sword', 'bridge', 'train', 'ladder'],
    'Love 💕': ['teddy bear/teddy/bear', 'chocolate', 'love letter/letter', 'rose', 'cupid', 'wedding cake'],
  },
  3: {
    Animal: ['kangaroo', 'flamingo', 'dinosaur/dino/t rex/trex', 'unicorn', 'dragon', 'jellyfish', 'peacock', 'scorpion', 'sloth', 'hedgehog'],
    Scene: ['waterfall', 'tornado/twister', 'rollercoaster/roller coaster', 'haunted house', 'treasure map/map', 'igloo', 'pyramid/pyramids', 'eiffel tower', 'fireworks/firework'],
    Action: ['picnic', 'selfie', 'haircut', 'fishing', 'yoga', 'swimming/swim', 'skateboarding/skateboard', 'camping', 'snowball fight'],
    Character: ['mermaid', 'astronaut/spaceman', 'pirate', 'vampire/dracula', 'wizard', 'superhero', 'alien/ufo', 'ninja', 'zombie'],
    'Love 💕': ['first date/date', 'breakfast in bed', 'slow dance/dancing/dance', 'road trip', 'honeymoon', 'proposal/marriage proposal/propose', 'candlelit dinner/candlelight dinner/romantic dinner/date night'],
  },
};

export function pickWord(level, avoid = []) {
  const pool = [];
  for (const [cat, list] of Object.entries(WORDS[level] || WORDS[1])) {
    for (const entry of list) {
      const [word, ...aliases] = entry.split('/');
      pool.push({ word, cat, aliases });
    }
  }
  const fresh = pool.filter((w) => !avoid.includes(w.word));
  const src = fresh.length ? fresh : pool;
  return src[Math.floor(Math.random() * src.length)];
}

export function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(a|an|the|some|my|it s|its|it is) /, '');
}

function variants(s) {
  const n = normalize(s);
  const out = new Set([n, n.replace(/ /g, '')]);
  for (const x of [...out]) {
    if (x.endsWith('es')) out.add(x.slice(0, -2));
    if (x.endsWith('s')) out.add(x.slice(0, -1));
  }
  return out;
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Returns 'yes' | 'close' | 'no' | 'empty'.
export function judge(guess, answers) {
  const g = normalize(guess);
  if (!g) return 'empty';
  const gv = variants(guess);
  for (const a of answers) {
    const av = variants(a);
    for (const x of gv) if (av.has(x)) return 'yes';
  }
  const gc = g.replace(/ /g, '');
  let best = Infinity, bestLen = 0, contains = false;
  for (const a of answers) {
    const ac = normalize(a).replace(/ /g, '');
    const d = lev(ac, gc);
    if (d < best) { best = d; bestLen = ac.length; }
    if (gc.length >= 3 && (ac.includes(gc) || gc.includes(ac))) contains = true;
  }
  if (best === 1 && bestLen >= 5) return 'yes'; // forgive a typo on longer words
  if ((best <= 2 && bestLen >= 4) || contains) return 'close';
  return 'no';
}
