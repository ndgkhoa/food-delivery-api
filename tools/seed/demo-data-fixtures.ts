export type ProvisionableRole = 'admin' | 'restaurant-owner' | 'customer' | 'driver';

export interface UserFixture {
  usernameSuffix: string;
  role: ProvisionableRole;
  password: string;
}

export interface MenuItemFixture {
  name: string;
  description: string;
  priceCents: number;
  stockQty: number;
}

export interface RestaurantFixture {
  name: string;
  description: string;
  menuItems: MenuItemFixture[];
}

export interface TenantFixture {
  slug: string;
  name: string;
  usernamePrefix: string;
  users: UserFixture[];
  restaurants: RestaurantFixture[];
}

function users(prefix: string): UserFixture[] {
  return [
    { usernameSuffix: 'admin', role: 'admin', password: `${prefix}-Admin1!` },
    { usernameSuffix: 'owner', role: 'restaurant-owner', password: `${prefix}-Owner1!` },
    { usernameSuffix: 'customer', role: 'customer', password: `${prefix}-Customer1!` },
    { usernameSuffix: 'driver', role: 'driver', password: `${prefix}-Driver1!` },
  ];
}

function menuItem(name: string, description: string, priceCents: number): MenuItemFixture {
  return { name, description, priceCents, stockQty: 100 };
}

export const TENANT_FIXTURES: TenantFixture[] = [
  {
    slug: 'demo-acme-foods',
    name: 'Demo Acme Foods',
    usernamePrefix: 'demo-acme',
    users: users('demo-acme'),
    restaurants: [
      {
        name: 'Pho Corner',
        description: 'Vietnamese noodle house',
        menuItems: [
          menuItem('Pho Bo', 'Beef noodle soup', 5500),
          menuItem('Pho Ga', 'Chicken noodle soup', 5000),
          menuItem('Goi Cuon', 'Fresh spring rolls', 3500),
          menuItem('Ca Phe Sua Da', 'Vietnamese iced coffee', 2500),
        ],
      },
      {
        name: 'Sushi Sakura',
        description: 'Japanese sushi bar',
        menuItems: [
          menuItem('Salmon Nigiri (6pc)', 'Fresh salmon over seasoned rice', 7200),
          menuItem('California Roll', 'Crab, avocado, cucumber', 6000),
          menuItem('Miso Soup', 'Traditional soybean broth', 2000),
          menuItem('Chicken Katsu', 'Breaded chicken cutlet', 8500),
        ],
      },
      {
        name: 'Burger Barn',
        description: 'American burgers',
        menuItems: [
          menuItem('Classic Cheeseburger', 'Beef patty, cheddar, house sauce', 6500),
          menuItem('Bacon BBQ Burger', 'Bacon, onion rings, BBQ sauce', 7500),
          menuItem('Crispy Fries', 'Seasoned skin-on fries', 3000),
          menuItem('Vanilla Milkshake', 'Hand-spun shake', 4000),
        ],
      },
    ],
  },
  {
    slug: 'demo-best-bites',
    name: 'Demo Best Bites',
    usernamePrefix: 'demo-bites',
    users: users('demo-bites'),
    restaurants: [
      {
        name: 'Trattoria Rossi',
        description: 'Italian trattoria',
        menuItems: [
          menuItem('Margherita Pizza', 'Tomato, mozzarella, basil', 8000),
          menuItem('Spaghetti Carbonara', 'Egg, pancetta, pecorino', 7800),
          menuItem('Tiramisu', 'Classic mascarpone dessert', 4200),
          menuItem('Bruschetta', 'Grilled bread, tomato, garlic', 3200),
        ],
      },
      {
        name: 'Taco Fiesta',
        description: 'Mexican street food',
        menuItems: [
          menuItem('Carne Asada Tacos (3pc)', 'Grilled steak, onion, cilantro', 5900),
          menuItem('Chicken Quesadilla', 'Melted cheese, grilled chicken', 5200),
          menuItem('Guacamole & Chips', 'Fresh avocado dip', 3300),
          menuItem('Horchata', 'Rice + cinnamon drink', 2200),
        ],
      },
      {
        name: 'Curry House',
        description: 'Indian curry kitchen',
        menuItems: [
          menuItem('Butter Chicken', 'Creamy tomato curry', 7000),
          menuItem('Vegetable Biryani', 'Basmati rice, mixed vegetables', 6200),
          menuItem('Garlic Naan', 'Tandoor-baked flatbread', 2000),
          menuItem('Mango Lassi', 'Yogurt mango drink', 2800),
        ],
      },
    ],
  },
];

export const CONFIG_VALUES: Array<{ key: string; value: number }> = [
  { key: 'order.delivery_fee_cents', value: 1200 },
  { key: 'order.vat_rate_bps', value: 800 },
  { key: 'order.discount_cents', value: 200 },
];

export const CONFIG_DEFAULTS: Record<string, number> = {
  'order.delivery_fee_cents': 1500,
  'order.vat_rate_bps': 1000,
  'order.discount_cents': 0,
};

export const DEMO_CITY_ORIGIN = { lat: 10.7769, lng: 106.7009 };

export const REVIEW_COMMENTS: string[] = [
  'Great food, arrived warm and right on time!',
  'Tasty and well packaged — would order again.',
  'Good portion size, delivery was quick.',
];
