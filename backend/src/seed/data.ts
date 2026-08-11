/**
 * Realistic sample data for development and demonstration.
 *
 * Names, locations and occupations are drawn from common Nigerian usage so the demo
 * reads like a real church register rather than placeholder text.
 */

export const SURNAMES = [
  'Adeyemi', 'Okonkwo', 'Balogun', 'Chukwu', 'Oyelaran', 'Eze', 'Afolabi', 'Nwachukwu',
  'Ogundipe', 'Bassey', 'Adeleke', 'Obi', 'Ilesanmi', 'Umeh', 'Akinyele', 'Ifeanyi',
  'Oluwaseun', 'Danjuma', 'Musa', 'Abubakar', 'Yakubu', 'Olawale', 'Nwosu', 'Ekanem',
  'Oyedepo', 'Adebayo', 'Onyeka', 'Salami', 'Ojo', 'Igwe', 'Amadi', 'Fashola',
  'Okoro', 'Ademola', 'Uzoma', 'Adesanya', 'Ogunleye', 'Chinedu', 'Aliyu', 'Etim',
];

export const MALE_NAMES = [
  'Emeka', 'Tunde', 'Chinedu', 'Segun', 'Ibrahim', 'Oluwafemi', 'Kelechi', 'Bamidele',
  'Chukwuemeka', 'Ayodeji', 'Ikechukwu', 'Olumide', 'Abdullahi', 'Chidi', 'Gbenga',
  'Uchenna', 'Babatunde', 'Nnamdi', 'Damilola', 'Obinna', 'Adewale', 'Sunday',
  'Emmanuel', 'Samuel', 'Daniel', 'Peter', 'Joseph', 'David', 'Michael', 'Timothy',
];

export const FEMALE_NAMES = [
  'Ngozi', 'Folake', 'Amaka', 'Bisi', 'Aisha', 'Oluwaseyi', 'Chioma', 'Yetunde',
  'Adaeze', 'Temitope', 'Ifeoma', 'Kemi', 'Zainab', 'Chinelo', 'Bukola', 'Uchechi',
  'Abimbola', 'Nkechi', 'Modupe', 'Onyinye', 'Funmilayo', 'Blessing', 'Grace',
  'Esther', 'Ruth', 'Deborah', 'Mercy', 'Faith', 'Joy', 'Precious',
];

export const MIDDLE_NAMES = [
  'Oluwatobiloba', 'Chidera', 'Ayomide', 'Ebubechukwu', 'Oluwadamilare', 'Chiamaka',
  'Olamide', 'Somtochukwu', 'Toluwalase', 'Munachimso', 'Oluwaseyi', 'Chizaram',
];

export const OCCUPATIONS = [
  'Teacher', 'Trader', 'Civil Servant', 'Accountant', 'Nurse', 'Software Developer',
  'Tailor', 'Banker', 'Mechanic', 'Student', 'Pharmacist', 'Electrician', 'Farmer',
  'Caterer', 'Lawyer', 'Engineer', 'Hairdresser', 'Driver', 'Doctor', 'Entrepreneur',
  'Sales Executive', 'Architect', 'Logistics Officer', 'Fashion Designer',
];

export const DEPARTMENTS = [
  'Choir', 'Ushering', 'Media', 'Protocol', 'Children Church', 'Prayer Band',
  'Evangelism', 'Welfare', 'Technical', 'Sanctuary Keepers', 'Hospitality',
];

/** Lagos-centred locations, matching a typical urban church footprint. */
export const LOCATIONS = [
  { state: 'Lagos', lga: 'Ikeja', city: 'Ikeja', communities: ['Oregun', 'Alausa', 'Opebi', 'Allen'] },
  { state: 'Lagos', lga: 'Kosofe', city: 'Ketu', communities: ['Alapere', 'Ojota', 'Mile 12', 'Magodo'] },
  { state: 'Lagos', lga: 'Alimosho', city: 'Ikotun', communities: ['Egbeda', 'Idimu', 'Igando', 'Ejigbo'] },
  { state: 'Lagos', lga: 'Eti-Osa', city: 'Lekki', communities: ['Ajah', 'Ikate', 'Sangotedo', 'Osapa'] },
  { state: 'Lagos', lga: 'Surulere', city: 'Surulere', communities: ['Aguda', 'Ijesha', 'Itire', 'Coker'] },
  { state: 'Ogun', lga: 'Ado-Odo/Ota', city: 'Ota', communities: ['Sango', 'Iyana Iyesi', 'Ijoko'] },
  { state: 'Ogun', lga: 'Obafemi Owode', city: 'Mowe', communities: ['Ibafo', 'Redemption Camp', 'Asese'] },
];

export const STREET_NAMES = [
  'Adeniyi Jones Avenue', 'Awolowo Way', 'Herbert Macaulay Street', 'Ogunlana Drive',
  'Bode Thomas Street', 'Toyin Street', 'Allen Avenue', 'Isaac John Street',
  'Church Street', 'Market Road', 'Olusegun Obasanjo Way', 'Unity Close',
];

/** Zone → Area → Homecell structure, sized to exercise every roll-up path. */
export const STRUCTURE = [
  {
    code: 'ZN-01',
    name: 'Ikeja Zone',
    description: 'Covers the Ikeja and Kosofe corridors of the church.',
    areas: [
      {
        code: 'AR-01',
        name: 'Oregun Area',
        homecells: [
          { code: 'HC-001', name: 'Grace Homecell', location: 'Oregun', address: '14 Kudirat Abiola Way, Oregun' },
          { code: 'HC-002', name: 'Zion Homecell', location: 'Alausa', address: '7 Obafemi Awolowo Way, Alausa' },
          { code: 'HC-003', name: 'Bethel Homecell', location: 'Opebi', address: '22 Opebi Road, Ikeja' },
        ],
      },
      {
        code: 'AR-02',
        name: 'Ketu Area',
        homecells: [
          { code: 'HC-004', name: 'Rehoboth Homecell', location: 'Alapere', address: '5 Alapere Road, Ketu' },
          { code: 'HC-005', name: 'Shiloh Homecell', location: 'Ojota', address: '31 Ogudu Road, Ojota' },
        ],
      },
    ],
  },
  {
    code: 'ZN-02',
    name: 'Lekki Zone',
    description: 'Covers the Lekki–Ajah axis.',
    areas: [
      {
        code: 'AR-03',
        name: 'Lekki Phase One Area',
        homecells: [
          { code: 'HC-006', name: 'Emmanuel Homecell', location: 'Ikate', address: '9 Freedom Way, Lekki' },
          { code: 'HC-007', name: 'Solid Rock Homecell', location: 'Osapa', address: '18 Kusenla Road, Ikate' },
        ],
      },
      {
        code: 'AR-04',
        name: 'Ajah Area',
        homecells: [
          { code: 'HC-008', name: 'Cornerstone Homecell', location: 'Sangotedo', address: '3 Lagos-Epe Expressway, Ajah' },
          { code: 'HC-009', name: 'Living Faith Homecell', location: 'Ajah', address: '27 Addo Road, Ajah' },
        ],
      },
    ],
  },
  {
    code: 'ZN-03',
    name: 'Ota Zone',
    description: 'Covers the Ogun State corridor.',
    areas: [
      {
        code: 'AR-05',
        name: 'Sango Area',
        homecells: [
          { code: 'HC-010', name: 'Mount Zion Homecell', location: 'Sango', address: '11 Idiroko Road, Sango Ota' },
          { code: 'HC-011', name: 'Overcomers Homecell', location: 'Ijoko', address: '6 Ijoko Road, Ota' },
        ],
      },
    ],
  },
];

export const EXPENSE_CATEGORIES = [
  {
    code: 'MONTHLY_DUES',
    name: 'Monthly Dues',
    description: 'Recurring Homecell dues remitted upward.',
    approvalThresholdMinor: 0,
    requiresReceipt: false,
  },
  {
    code: 'APPROVED_PURCHASES',
    name: 'Approved Purchases',
    description: 'Items purchased with prior approval.',
    approvalThresholdMinor: 500_000,
    requiresReceipt: true,
  },
  {
    code: 'WELFARE',
    name: 'Welfare',
    description: 'Support extended to members in need.',
    approvalThresholdMinor: 0,
    requiresReceipt: false,
  },
  {
    code: 'MEETING_MATERIALS',
    name: 'Meeting Materials',
    description: 'Booklets, refreshments and materials for Homecell meetings.',
    approvalThresholdMinor: 1_000_000,
    requiresReceipt: false,
  },
  {
    code: 'TRANSPORT',
    name: 'Transport',
    description: 'Approved travel for Homecell activities.',
    approvalThresholdMinor: 300_000,
    requiresReceipt: true,
  },
  {
    code: 'OTHER',
    name: 'Other Approved Expenses',
    description: 'Expenses that do not fall under a specific category.',
    approvalThresholdMinor: 0,
    requiresReceipt: true,
  },
];

export const EXPENSE_DESCRIPTIONS: Record<string, string[]> = {
  MONTHLY_DUES: ['Monthly Homecell dues', 'Area dues contribution'],
  APPROVED_PURCHASES: [
    'Plastic chairs for meeting venue',
    'Rechargeable lamp for evening meetings',
    'Bible study booklets for new members',
  ],
  WELFARE: [
    'Welfare support for a bereaved member',
    'Hospital visitation support',
    'Support for a member in transition',
  ],
  MEETING_MATERIALS: [
    'Refreshments for Sunday Homecell',
    'Printing of attendance registers',
    'Water and disposable cups',
  ],
  TRANSPORT: ['Transport for follow-up visitation', 'Transport to Area meeting'],
  OTHER: ['Venue cleaning', 'Minor repairs at meeting venue'],
};

export const OFFERING_DESCRIPTIONS = [
  'Sunday Homecell offering',
  'Sunday Homecell offering and thanksgiving',
  'Sunday Homecell offering (well attended)',
];

export const TRANSFER_REASONS = [
  'Relocated closer to the destination Homecell',
  'Family joined the destination Homecell',
  'Work relocation to a new part of the city',
  'Requested a Homecell nearer to residence',
  'Moved after marriage',
];
