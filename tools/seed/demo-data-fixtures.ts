/** Mirrors `PROVISIONABLE_ROLES` in `apps/auth/src/interface/http/dto/provision-user.request.ts`. */
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
  /** Every seeded username is `${usernamePrefix}-${user.usernameSuffix}`, e.g. `demo-acme-owner`. */
  usernamePrefix: string;
  users: UserFixture[];
  restaurants: RestaurantFixture[];
}

/**
 * `admin` is provisioned per tenant IN ADDITION TO owner/customer/driver: a
 * config write (`PUT /config/:key`) without `global: true` always targets the
 * CALLER'S OWN tenant (`UpsertConfigValueHandler`), and a `global` write needs
 * `platform-admin`, a role no seeded user holds. So the only way to set a
 * tenant-scoped config override for a NEW tenant is to authenticate as an
 * `admin` belonging to that exact tenant.
 */
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

/** Business tunables `PlaceOrderHandler` reads (`apps/order/.../place-order.handler.ts`). */
export const CONFIG_VALUES: Array<{ key: string; value: number }> = [
  { key: 'order.delivery_fee_cents', value: 1200 },
  { key: 'order.vat_rate_bps', value: 800 },
  { key: 'order.discount_cents', value: 200 },
];

/** Order service's hardcoded fallbacks — `down` restores these since no `DELETE /config/:key` route exists. */
export const CONFIG_DEFAULTS: Record<string, number> = {
  'order.delivery_fee_cents': 1500,
  'order.vat_rate_bps': 1000,
  'order.discount_cents': 0,
};

/**
 * Rough Ho Chi Minh City center — anchors the plausible driver GEO seed
 * coordinates (`seed-up-delivery.ts`). No real restaurant geo exists yet to
 * anchor against, so this is a fixed, deliberately fictional demo point.
 */
export const DEMO_CITY_ORIGIN = { lat: 10.7769, lng: 106.7009 };

/** Rotated across seeded demo reviews (`seed-up-reviews.ts`) — flavor text only, never interpolated into a query. */
export const REVIEW_COMMENTS: string[] = [
  'Great food, arrived warm and right on time!',
  'Tasty and well packaged — would order again.',
  'Good portion size, delivery was quick.',
];
