import { CreateMenuItemRequest } from '@catalog/interface/http/dto/create-menu-item.request';
import { CreateRestaurantRequest } from '@catalog/interface/http/dto/create-restaurant.request';
import { UpdateRestaurantRequest } from '@catalog/interface/http/dto/update-restaurant.request';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

/**
 * Guards H2: a whitespace-only `name` must fail validation (→ HTTP 400) rather
 * than trimming to '' inside the domain and surfacing as a 500. Trimming lives
 * on the create DTOs and is inherited by the PartialType update DTOs.
 */
describe('request name trimming', () => {
  it('rejects a whitespace-only restaurant name', () => {
    const dto = plainToInstance(CreateRestaurantRequest, { name: '   ' });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('trims a padded restaurant name to its inner value', () => {
    const dto = plainToInstance(CreateRestaurantRequest, { name: '  Pho House  ' });
    expect(dto.name).toBe('Pho House');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a whitespace-only menu-item name', () => {
    const dto = plainToInstance(CreateMenuItemRequest, { name: '   ', priceCents: 100 });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a whitespace-only name on the inherited update DTO', () => {
    const dto = plainToInstance(UpdateRestaurantRequest, { name: '   ' });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
