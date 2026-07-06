/**
 * FIBA Women's Basketball World Cup 2026 — team rosters (static dataset).
 *
 * There is no free live basketball data feed comparable to the openfootball
 * World Cup source, so the 16 qualified teams and their players are embedded
 * here and consumed by scripts/seed-womens-basketball-world-cup.ts.
 *
 * PROVISIONAL DATA: as of mid-2026 the final 12-player Berlin squads are not
 * officially published (they are announced in late August). Each roster is the
 * most recent official squad available — the March 2026 FIBA Women's World Cup
 * Qualifying Tournaments where available, otherwise the team's 2025 continental
 * championship squad (EuroBasket Women 2025 / AmeriCup 2025 / Asia Cup 2025 /
 * AfroBasket 2025). Refresh closer to the tournament when final rosters drop.
 *
 * Positions are the basketball trio G (guard), F (forward), C (center).
 */

export type BasketballPosition = 'G' | 'F' | 'C';

export interface RosterPlayer {
  name: string;
  position: BasketballPosition;
  /** Jersey number when known (omitted for a few late call-ups). */
  number?: number;
}

export interface RosterTeam {
  /** Display name. */
  name: string;
  /** FIBA 3-letter code, used as the player's realTeamId. */
  code: string;
  /** Preliminary-round group from the 21 April 2026 draw. */
  group: 'A' | 'B' | 'C' | 'D';
  /** Source used for this provisional roster. */
  source: string;
  players: RosterPlayer[];
}

export const WBWC_2026_ROSTERS: RosterTeam[] = [
  // ─── Group A ────────────────────────────────────────────────────────────
  {
    name: 'Japan',
    code: 'JPN',
    group: 'A',
    source: 'FIBA WWC 2026 Qualifying Tournament (Istanbul)',
    players: [
      { name: 'Norika Konno', position: 'G', number: 2 },
      { name: 'Stephanie Mawuli', position: 'F', number: 3 },
      { name: 'Maki Takada', position: 'C', number: 8 },
      { name: 'Ramu Tokashiki', position: 'C', number: 10 },
      { name: 'Rui Machida', position: 'G', number: 13 },
      { name: 'Azusa Asahina', position: 'F', number: 14 },
      { name: 'Mai Yamamoto', position: 'G', number: 23 },
      { name: 'Kokoro Tanaka', position: 'G', number: 26 },
      { name: 'Aika Hirashita', position: 'F', number: 31 },
      { name: 'Minami Yabu', position: 'G', number: 37 },
      { name: 'Yuki Miyazawa', position: 'F', number: 52 },
      { name: 'Nanako Todo', position: 'G', number: 75 },
    ],
  },
  {
    name: 'Spain',
    code: 'ESP',
    group: 'A',
    source: 'FIBA WWC 2026 Qualifying Tournament (San Juan)',
    players: [
      { name: 'Elena Buenavida', position: 'G', number: 2 },
      { name: 'Mariona Ortiz', position: 'G', number: 4 },
      { name: 'Maite Cazorla', position: 'G', number: 5 },
      { name: 'Aina Ayuso', position: 'G', number: 6 },
      { name: 'Maria Araujo', position: 'F', number: 8 },
      { name: 'Helena Pueyo', position: 'F', number: 9 },
      { name: 'Maria Conde', position: 'F', number: 10 },
      { name: 'Awa Fam', position: 'C', number: 11 },
      { name: 'Raquel Carrera', position: 'C', number: 14 },
      { name: 'Megan Gustafson', position: 'C', number: 17 },
      { name: 'Paula Ginzo', position: 'C', number: 20 },
      { name: 'Iyana Martin', position: 'G', number: 44 },
    ],
  },
  {
    name: 'Germany',
    code: 'GER',
    group: 'A',
    source: 'FIBA WWC 2026 Qualifying Tournament (Villeurbanne)',
    players: [
      { name: 'Alexis Peterson', position: 'G', number: 1 },
      { name: 'Alexandra Wilke', position: 'G', number: 3 },
      { name: 'Jennifer Crowder', position: 'G', number: 7 },
      { name: 'Nyara Sabally', position: 'F', number: 8 },
      { name: 'Emma Eichmeyer', position: 'F', number: 9 },
      { name: 'Leonie Fiebich', position: 'G', number: 13 },
      { name: 'Alina Hartmann', position: 'F', number: 16 },
      { name: 'Britta Daub', position: 'G', number: 19 },
      { name: 'Frieda Buhner', position: 'F', number: 20 },
      { name: 'Emily Bessoir', position: 'F', number: 22 },
      { name: 'Nina Rosemeyer', position: 'G', number: 33 },
      { name: 'Patricia Brossmann', position: 'F', number: 34 },
    ],
  },
  {
    name: 'Mali',
    code: 'MLI',
    group: 'A',
    source: 'FIBA WWC 2026 Qualifying Tournament (Wuhan)',
    players: [
      { name: 'Oummou Koumare', position: 'F', number: 0 },
      { name: 'Foune Sissoko', position: 'F', number: 1 },
      { name: 'Djeneba Sangare', position: 'G', number: 2 },
      { name: 'Rokia Doumbia', position: 'C', number: 6 },
      { name: 'Maimouna Haidara', position: 'F', number: 10 },
      { name: 'Aminata Samassekou', position: 'G', number: 11 },
      { name: 'Alima Dembele', position: 'G', number: 12 },
      { name: 'Mama Cisse', position: 'C', number: 13 },
      { name: 'Kamite Elisabeth Dabou', position: 'F', number: 22 },
      { name: 'Sika Kone', position: 'F', number: 23 },
      { name: "Djeneba N'Diaye", position: 'G', number: 50 },
      { name: 'Diana Balayera', position: 'C', number: 77 },
    ],
  },

  // ─── Group B ────────────────────────────────────────────────────────────
  {
    name: 'Hungary',
    code: 'HUN',
    group: 'B',
    source: 'FIBA WWC 2026 Qualifying Tournament (Istanbul)',
    players: [
      { name: 'Virag Takacs-Kiss', position: 'C', number: 2 },
      { name: 'Reka Dombai', position: 'F', number: 3 },
      { name: 'Debora Dubei', position: 'F', number: 4 },
      { name: 'Nina Aho', position: 'G', number: 10 },
      { name: 'Kinga Josepovits', position: 'C', number: 11 },
      { name: 'Agnes Torok', position: 'F', number: 13 },
      { name: 'Dorka Juhasz', position: 'F', number: 14 },
      { name: 'Aliz Varga', position: 'F', number: 18 },
      { name: 'Reka Lelik', position: 'G', number: 21 },
      { name: 'Yvonne Turner', position: 'G', number: 22 },
      { name: 'Panka Dul', position: 'G', number: 33 },
      { name: 'Petra Toman', position: 'F', number: 42 },
    ],
  },
  {
    name: 'South Korea',
    code: 'KOR',
    group: 'B',
    source: 'FIBA WWC 2026 Qualifying Tournament (Villeurbanne)',
    players: [
      { name: 'Jihyun Park', position: 'F', number: 1 },
      { name: 'Yeeun Heo', position: 'G', number: 2 },
      { name: 'Leeseul Kang', position: 'F', number: 3 },
      { name: 'Heji An', position: 'G', number: 5 },
      { name: 'Isaem Choi', position: 'F', number: 6 },
      { name: 'Jisu Park', position: 'C', number: 7 },
      { name: 'Sohee Lee', position: 'G', number: 9 },
      { name: 'Yoolim Kang', position: 'F', number: 10 },
      { name: 'Sohee Park', position: 'G', number: 11 },
      { name: 'Haeran Lee', position: 'F', number: 12 },
      { name: 'Yusun Hong', position: 'C', number: 39 },
      { name: 'An Jin', position: 'C', number: 77 },
    ],
  },
  {
    name: 'Nigeria',
    code: 'NGA',
    group: 'B',
    source: 'FIBA WWC 2026 Qualifying Tournament (Villeurbanne)',
    players: [
      { name: 'Amy Okonkwo', position: 'F', number: 0 },
      { name: 'Pallas Kunaiyi-Akpanah', position: 'C', number: 3 },
      { name: 'Elizabeth Balogun', position: 'G', number: 4 },
      { name: 'Sarah Ogoke', position: 'G', number: 7 },
      { name: 'Ifunanya Okoro', position: 'G', number: 9 },
      { name: 'Promise Amukamara', position: 'G', number: 10 },
      { name: 'Murjanatu Musa', position: 'F', number: 20 },
      { name: 'Blessing Ejiofor', position: 'F', number: 22 },
      { name: 'Ezinne Kalu', position: 'G', number: 23 },
      { name: 'Victoria Macaulay', position: 'C', number: 25 },
      { name: 'Rita Igbokwe', position: 'C', number: 32 },
      { name: 'Nicole Enabosi', position: 'F', number: 33 },
    ],
  },
  {
    name: 'France',
    code: 'FRA',
    group: 'B',
    source: 'FIBA WWC 2026 Qualifying Tournament (Villeurbanne)',
    players: [
      { name: 'Alexia Chery', position: 'F', number: 6 },
      { name: 'Valeriane Ayayi', position: 'F', number: 11 },
      { name: 'Janelle Salaun', position: 'F', number: 13 },
      { name: 'Dominique Malonga', position: 'C', number: 14 },
      { name: 'Gabby Williams', position: 'F', number: 15 },
      { name: 'Marieme Badiane', position: 'C', number: 22 },
      { name: 'Marine Johannes', position: 'G', number: 23 },
      { name: 'Migna Toure', position: 'G', number: 28 },
      { name: 'Aminata Gueye', position: 'C', number: 31 },
      { name: 'Leila Lacan', position: 'G', number: 42 },
      { name: 'Romane Bernies', position: 'G', number: 47 },
      { name: 'Pauline Astier', position: 'G', number: 98 },
    ],
  },

  // ─── Group C ────────────────────────────────────────────────────────────
  {
    name: 'Belgium',
    code: 'BEL',
    group: 'C',
    source: 'EuroBasket Women 2025 squad',
    players: [
      { name: 'Julie Allemand', position: 'G', number: 55 },
      { name: 'Julie Vanloo', position: 'G', number: 35 },
      { name: 'Elise Ramette', position: 'G', number: 4 },
      { name: 'Antonia Delaere', position: 'F', number: 6 },
      { name: 'Emma Meesseman', position: 'F', number: 11 },
      { name: 'Nastja Claessens', position: 'F', number: 5 },
      { name: 'Bethy Mununga', position: 'F', number: 22 },
      { name: 'Marie Vervaet', position: 'F', number: 27 },
      { name: 'Maxuelle Lisowa-Mbaka', position: 'F', number: 31 },
      { name: 'Kyara Linskens', position: 'C', number: 13 },
      { name: 'Becky Massey', position: 'C', number: 25 },
      { name: 'Ine Joris', position: 'C', number: 99 },
    ],
  },
  {
    name: 'Australia',
    code: 'AUS',
    group: 'C',
    source: 'FIBA WWC 2026 Qualifying Tournament (Istanbul)',
    players: [
      { name: 'Sami Whitcomb', position: 'G' },
      { name: 'Steph Talbot', position: 'F' },
      { name: 'Jade Melbourne', position: 'G' },
      { name: 'Ezi Magbegor', position: 'C' },
      { name: 'Alanna Smith', position: 'F' },
      { name: 'Cayla George', position: 'F', number: 15 },
      { name: 'Chloe Bibby', position: 'F', number: 55 },
      { name: 'Stephanie Reid', position: 'G', number: 12 },
      { name: 'Zitina Aokuso', position: 'F', number: 22 },
      { name: 'Isobel Borlase', position: 'G', number: 20 },
      { name: 'Alexandra Fowler', position: 'F', number: 23 },
      { name: 'Alex Wilson', position: 'G', number: 44 },
    ],
  },
  {
    name: 'Puerto Rico',
    code: 'PUR',
    group: 'C',
    source: '2025 FIBA Women\'s AmeriCup squad',
    players: [
      { name: 'Pamela Rosado', position: 'G', number: 5 },
      { name: 'Arella Guirantes', position: 'G', number: 22 },
      { name: 'Brianna Jones', position: 'G', number: 2 },
      { name: 'Ahlana Smith', position: 'G', number: 12 },
      { name: 'Angelica Velez', position: 'G', number: 15 },
      { name: 'Trinity San Antonio', position: 'G', number: 23 },
      { name: 'Jacqueline Benitez', position: 'G', number: 55 },
      { name: 'Tayra Melendez', position: 'F', number: 1 },
      { name: 'Mya Hollingshed', position: 'F', number: 21 },
      { name: 'Denise Solis', position: 'F', number: 25 },
      { name: 'Sofia Roma', position: 'C', number: 11 },
      { name: 'India Pagan', position: 'C', number: 33 },
    ],
  },
  {
    name: 'Turkey',
    code: 'TUR',
    group: 'C',
    source: 'EuroBasket Women 2025 squad',
    players: [
      { name: 'Olcay Cakir', position: 'G', number: 4 },
      { name: 'Sevgi Uzun', position: 'G', number: 2 },
      { name: 'Pelin Bilgic', position: 'G', number: 9 },
      { name: 'Alperi Onar', position: 'G', number: 10 },
      { name: 'Derin Erdogan', position: 'G', number: 17 },
      { name: 'Goksen Fitik', position: 'F', number: 6 },
      { name: 'Elif Istanbulluoglu', position: 'F', number: 1 },
      { name: 'Elif Bayram', position: 'F', number: 11 },
      { name: 'Tilbe Senyurek', position: 'F', number: 15 },
      { name: 'Sinem Atas', position: 'F', number: 20 },
      { name: 'Teaira McCowan', position: 'C', number: 7 },
      { name: 'Esra Ural', position: 'C', number: 33 },
    ],
  },

  // ─── Group D ────────────────────────────────────────────────────────────
  {
    name: 'United States',
    code: 'USA',
    group: 'D',
    source: 'FIBA WWC 2026 Qualifying Tournament (San Juan)',
    players: [
      { name: 'Paige Bueckers', position: 'G', number: 4 },
      { name: 'Kelsey Plum', position: 'G', number: 5 },
      { name: 'Dearica Hamby', position: 'F', number: 6 },
      { name: 'Kahleah Copper', position: 'G', number: 7 },
      { name: 'Chelsea Gray', position: 'G', number: 8 },
      { name: 'Angel Reese', position: 'F', number: 9 },
      { name: 'Rhyne Howard', position: 'G', number: 10 },
      { name: 'Rae Burrell', position: 'F', number: 11 },
      { name: 'Caitlin Clark', position: 'G', number: 12 },
      { name: 'Jackie Young', position: 'G', number: 13 },
      { name: 'Monique Billings', position: 'F', number: 14 },
      { name: 'Kiki Iriafen', position: 'F', number: 15 },
    ],
  },
  {
    name: 'Czechia',
    code: 'CZE',
    group: 'D',
    source: 'FIBA WWC 2026 Qualifying Tournament (Wuhan)',
    players: [
      { name: 'Katerina Zeithammerova', position: 'G', number: 1 },
      { name: 'Julie Pospisilova', position: 'F', number: 2 },
      { name: 'Gabriela Andelova', position: 'G', number: 4 },
      { name: 'Natalie Stoupalova', position: 'F', number: 5 },
      { name: 'Petra Malikova', position: 'G', number: 7 },
      { name: 'Veronika Vorackova', position: 'F', number: 8 },
      { name: 'Karolina Sotolova', position: 'G', number: 9 },
      { name: 'Eliska Hamzova', position: 'G', number: 10 },
      { name: 'Monika Fucikova', position: 'G', number: 12 },
      { name: 'Petra Holesinska', position: 'G', number: 13 },
      { name: 'Emma Cechova', position: 'C', number: 22 },
      { name: 'Julia Reisingerova', position: 'C', number: 44 },
    ],
  },
  {
    name: 'Italy',
    code: 'ITA',
    group: 'D',
    source: 'FIBA WWC 2026 Qualifying Tournament (San Juan)',
    players: [
      { name: 'Jasmine Keys', position: 'F', number: 0 },
      { name: 'Francesca Pasa', position: 'G', number: 6 },
      { name: 'Costanza Verona', position: 'G', number: 8 },
      { name: 'Cecilia Zandalasini', position: 'F', number: 9 },
      { name: 'Francesca Pan', position: 'F', number: 11 },
      { name: 'Lorela Cubaj', position: 'C', number: 13 },
      { name: 'Sara Madera', position: 'F', number: 14 },
      { name: 'Mariella Santucci', position: 'G', number: 18 },
      { name: 'Martina Fassina', position: 'G', number: 19 },
      { name: 'Olbis Andre', position: 'C', number: 22 },
      { name: 'Laura Spreafico', position: 'F', number: 23 },
      { name: 'Martina Kacerik', position: 'G', number: 77 },
    ],
  },
  {
    name: 'China',
    code: 'CHN',
    group: 'D',
    source: 'FIBA WWC 2026 Qualifying Tournament (Wuhan)',
    players: [
      { name: 'Zhang Manman', position: 'G', number: 1 },
      { name: 'Wang Jiaqi', position: 'G', number: 3 },
      { name: 'Wang Siyu', position: 'G', number: 5 },
      { name: 'Yang Shuyu', position: 'G', number: 6 },
      { name: 'Tang Ziting', position: 'F', number: 9 },
      { name: 'Zhang Ru', position: 'F', number: 10 },
      { name: 'Luo Xinyu', position: 'F', number: 11 },
      { name: 'Chen Yujie', position: 'G', number: 12 },
      { name: 'Li Yueru', position: 'C', number: 14 },
      { name: 'Han Xu', position: 'C', number: 15 },
      { name: 'Chen Mingling', position: 'C', number: 18 },
      { name: 'Zhang Ziyu', position: 'C', number: 19 },
    ],
  },
];
