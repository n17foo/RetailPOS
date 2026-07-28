import { db } from '../utils/db';
import { generateUUID } from '../utils/uuid';

export interface TaxProfileRow {
  id: string;
  name: string;
  rate: number;
  is_default: number;
  is_active: number;
  region: string | null;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateTaxProfileInput {
  name: string;
  rate: number;
  isDefault?: boolean;
  region?: string | null;
  description?: string | null;
}

export interface UpdateTaxProfileInput {
  name?: string;
  rate?: number;
  isDefault?: boolean;
  isActive?: boolean;
  region?: string | null;
  description?: string | null;
}

export class TaxProfileRepository {
  async create(input: CreateTaxProfileInput): Promise<string> {
    const id = generateUUID();
    const now = Date.now();

    // If this is the default, unset any existing default first
    if (input.isDefault) {
      await db.runAsync('UPDATE tax_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1', [now]);
    }

    await db.runAsync(
      `INSERT INTO tax_profiles (id, name, rate, is_default, is_active, region, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [id, input.name, input.rate, input.isDefault ? 1 : 0, input.region ?? null, input.description ?? null, now, now]
    );

    return id;
  }

  async findAll(): Promise<TaxProfileRow[]> {
    return db.getAllAsync<TaxProfileRow>('SELECT * FROM tax_profiles ORDER BY is_default DESC, name ASC');
  }

  async findActive(): Promise<TaxProfileRow[]> {
    return db.getAllAsync<TaxProfileRow>('SELECT * FROM tax_profiles WHERE is_active = 1 ORDER BY is_default DESC, name ASC');
  }

  async findById(id: string): Promise<TaxProfileRow | null> {
    return db.getFirstAsync<TaxProfileRow>('SELECT * FROM tax_profiles WHERE id = ?', [id]);
  }

  async findDefault(): Promise<TaxProfileRow | null> {
    return db.getFirstAsync<TaxProfileRow>('SELECT * FROM tax_profiles WHERE is_default = 1 AND is_active = 1');
  }

  async update(id: string, input: UpdateTaxProfileInput): Promise<void> {
    const now = Date.now();

    // If setting as default, unset existing default first
    if (input.isDefault) {
      await db.runAsync('UPDATE tax_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1 AND id != ?', [now, id]);
    }

    const sets: string[] = [];
    const values: (string | number | boolean)[] = [];

    if (input.name !== undefined) {
      sets.push('name = ?');
      values.push(input.name);
    }
    if (input.rate !== undefined) {
      sets.push('rate = ?');
      values.push(input.rate);
    }
    if (input.isDefault !== undefined) {
      sets.push('is_default = ?');
      values.push(input.isDefault ? 1 : 0);
    }
    if (input.isActive !== undefined) {
      sets.push('is_active = ?');
      values.push(input.isActive ? 1 : 0);
    }
    if (input.region !== undefined) {
      sets.push('region = ?');
      values.push(input.region ?? '');
    }
    if (input.description !== undefined) {
      sets.push('description = ?');
      values.push(input.description ?? '');
    }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    values.push(now, id);

    await db.runAsync(`UPDATE tax_profiles SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  async delete(id: string): Promise<void> {
    await db.runAsync('DELETE FROM tax_profiles WHERE id = ?', [id]);
  }
}

export const taxProfileRepository = new TaxProfileRepository();
