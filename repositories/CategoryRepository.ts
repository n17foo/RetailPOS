import { db } from '../utils/db';
import { generateUUID } from '../utils/uuid';

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  parent_id?: string | null;
  image_url?: string | null;
  position: number;
  product_count: number;
  platform: string;
  platform_id?: string | null;
  level: number;
  path: string; // JSON-encoded string[]
  status: 'active' | 'hidden' | 'archived';
  created_at: number;
  updated_at: number;
}

export class CategoryRepository {
  async create(category: Omit<Category, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const now = Date.now();
    const id = generateUUID();
    await db.runAsync(
      `INSERT INTO categories (id, name, description, parent_id, image_url, position, product_count, platform, platform_id, level, path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        category.name,
        category.description ?? null,
        category.parent_id ?? null,
        category.image_url ?? null,
        category.position,
        category.product_count,
        category.platform,
        category.platform_id ?? null,
        category.level,
        category.path,
        category.status,
        now,
        now,
      ]
    );
    return id;
  }

  async upsert(category: Omit<Category, 'created_at' | 'updated_at'> & { id: string }): Promise<void> {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO categories (id, name, description, parent_id, image_url, position, product_count, platform, platform_id, level, path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         parent_id = excluded.parent_id,
         image_url = excluded.image_url,
         position = excluded.position,
         product_count = excluded.product_count,
         platform = excluded.platform,
         platform_id = excluded.platform_id,
         level = excluded.level,
         path = excluded.path,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [
        category.id,
        category.name,
        category.description ?? null,
        category.parent_id ?? null,
        category.image_url ?? null,
        category.position,
        category.product_count,
        category.platform,
        category.platform_id ?? null,
        category.level,
        category.path,
        category.status,
        now,
        now,
      ]
    );
  }

  async findById(id: string): Promise<Category | null> {
    return await db.getFirstAsync<Category>('SELECT * FROM categories WHERE id = ?', [id]);
  }

  async findAll(): Promise<Category[]> {
    return await db.getAllAsync<Category>('SELECT * FROM categories ORDER BY position ASC');
  }

  async findByPlatform(platform: string): Promise<Category[]> {
    return await db.getAllAsync<Category>('SELECT * FROM categories WHERE platform = ? ORDER BY position ASC', [platform]);
  }

  async findByParentId(parentId: string | null): Promise<Category[]> {
    if (parentId === null) {
      return await db.getAllAsync<Category>('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY position ASC');
    }
    return await db.getAllAsync<Category>('SELECT * FROM categories WHERE parent_id = ? ORDER BY position ASC', [parentId]);
  }

  async findRootCategories(platform?: string): Promise<Category[]> {
    if (platform) {
      return await db.getAllAsync<Category>('SELECT * FROM categories WHERE parent_id IS NULL AND platform = ? ORDER BY position ASC', [
        platform,
      ]);
    }
    return await db.getAllAsync<Category>('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY position ASC');
  }

  async findActive(platform?: string): Promise<Category[]> {
    if (platform) {
      return await db.getAllAsync<Category>("SELECT * FROM categories WHERE status = 'active' AND platform = ? ORDER BY position ASC", [
        platform,
      ]);
    }
    return await db.getAllAsync<Category>("SELECT * FROM categories WHERE status = 'active' ORDER BY position ASC");
  }

  async update(id: string, data: Partial<Category>): Promise<void> {
    const now = Date.now();
    const fields = Object.keys(data).filter(key => key !== 'id' && key !== 'created_at');
    if (fields.length === 0) return;

    const values = fields.map(key => data[key as keyof typeof data] as string | number | boolean);
    const statement = `UPDATE categories SET ${fields.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    await db.runAsync(statement, [...values, now, id] as (string | number | boolean)[]);
  }

  async delete(id: string): Promise<void> {
    await db.runAsync('DELETE FROM categories WHERE id = ?', [id]);
  }

  async deleteByPlatform(platform: string): Promise<void> {
    await db.runAsync('DELETE FROM categories WHERE platform = ?', [platform]);
  }

  async count(platform?: string): Promise<number> {
    const query = platform ? 'SELECT COUNT(*) as count FROM categories WHERE platform = ?' : 'SELECT COUNT(*) as count FROM categories';
    const params = platform ? [platform] : [];
    const result = await db.getFirstAsync<{ count: number }>(query, params);
    return result?.count ?? 0;
  }
}
