// Data management module
class DataManager {
    constructor() {
        this.company = {};
        // Legacy: kept for backward compatibility. Use `leads` as the single base.
        this.clients = [];
        this.leads = [];
        this.products = [];
        this.budgets = [];
        this.customFields = { leads: [], products: [] };
        this.categories = { leads: [], products: [] };
        this.ui = { modules: [] };
        this.currentEditId = null;
        this.budgetSelectedProducts = [];
    }

    loadData() {
        this.company = JSON.parse(localStorage.getItem('crm_company') || '{}');
        const storedLeads = JSON.parse(localStorage.getItem('crm_leads') || '[]');
        const storedClients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
        this.products = JSON.parse(localStorage.getItem('crm_products') || '[]');
        this.budgets = JSON.parse(localStorage.getItem('crm_budgets') || '[]');
        const storedCustomFields = JSON.parse(localStorage.getItem('crm_customFields') || '{ "clients": [], "products": [] }');
        const storedCategories = JSON.parse(localStorage.getItem('crm_categories') || '{ "clients": [], "products": [] }');
        this.ui = JSON.parse(localStorage.getItem('crm_ui') || '{ "modules": [] }');
        if (!this.ui || typeof this.ui !== 'object') this.ui = { modules: [] };
        if (!this.ui.dashboardsByCompany) this.ui.dashboardsByCompany = {};

        // Migration: unify Clients + Leads into a single Leads base
        // (runs once and sets a localStorage flag)
        const MIGRATION_KEY = 'crm_migration_unified_leads_v1';
        const alreadyMigrated = localStorage.getItem(MIGRATION_KEY) === '1';

        const normalizeLead = (lead) => {
            const l = lead && typeof lead === 'object' ? lead : {};
            const createdAt = l.createdAt || new Date().toISOString();
            const history = Array.isArray(l.history) ? l.history : [];

            // Back-compat: old schema { source, message }
            const notes = (l.notes ?? l.message ?? '').toString();
            const source = (l.source ?? '').toString();
            const status = (l.status ?? 'Novo').toString() || 'Novo';

            return {
                id: l.id || Date.now(),
                name: (l.name ?? '').toString(),
                email: (l.email ?? '').toString(),
                phone: (l.phone ?? '').toString(),
                source,
                campaign: (l.campaign ?? '').toString(),
                interest: (l.interest ?? '').toString(),
                content: (l.content ?? '').toString(),
                status,
                conversationStatus: (l.conversationStatus ?? '').toString(),
                classification: (l.classification ?? '').toString(),
                notes,
                company: (l.company ?? '').toString(),
                tags: (l.tags ?? '').toString(),
                createdAt,
                updatedAt: l.updatedAt || createdAt,
                history
            };
        };

        const merged = [];
        const byFingerprint = new Map();
        const fp = (obj) => {
            const phone = (obj.phone || '').replace(/\D/g, '');
            const email = (obj.email || '').toLowerCase().trim();
            if (phone) return `p:${phone}`;
            if (email) return `e:${email}`;
            return `i:${obj.id || ''}`;
        };

        (Array.isArray(storedLeads) ? storedLeads : []).forEach(item => {
            const lead = normalizeLead(item);
            const key = fp(lead);
            byFingerprint.set(key, lead);
            merged.push(lead);
        });

        if (!alreadyMigrated && Array.isArray(storedClients) && storedClients.length) {
            storedClients.forEach(client => {
                const c = client && typeof client === 'object' ? client : {};
                const lead = normalizeLead({
                    id: c.id,
                    name: c.name || '',
                    email: c.email || '',
                    phone: c.phone || '',
                    source: (c.source || 'cliente').toString(),
                    status: 'Convertido',
                    company: c.company || '',
                    notes: c.notes || '',
                    tags: c.tags || '',
                    createdAt: c.createdAt || new Date().toISOString(),
                    history: [{ at: new Date().toISOString(), type: 'migracao', text: 'Migrado de Clientes para Leads.' }]
                });

                const key = fp(lead);
                const existing = byFingerprint.get(key);
                if (existing) {
                    existing.company = existing.company || lead.company;
                    existing.notes = existing.notes || lead.notes;
                    existing.status = existing.status || lead.status;
                    existing.history = Array.isArray(existing.history) ? existing.history : [];
                    existing.history.push(...(lead.history || []));
                    existing.updatedAt = new Date().toISOString();
                } else {
                    // avoid id collision
                    if (merged.some(x => x.id === lead.id)) lead.id = Date.now() + Math.floor(Math.random() * 1000);
                    merged.push(lead);
                    byFingerprint.set(key, lead);
                }
            });

            localStorage.setItem(MIGRATION_KEY, '1');
            // prevent re-import loops
            localStorage.setItem('crm_clients', '[]');
        }

        this.leads = merged;
        this.clients = [];

        // Migrate categories/custom fields to leads
        const cf = storedCustomFields && typeof storedCustomFields === 'object' ? storedCustomFields : {};
        const cat = storedCategories && typeof storedCategories === 'object' ? storedCategories : {};
        this.customFields = {
            leads: Array.isArray(cf.leads) ? cf.leads : (Array.isArray(cf.clients) ? cf.clients : []),
            products: Array.isArray(cf.products) ? cf.products : []
        };
        this.categories = {
            leads: Array.isArray(cat.leads) ? cat.leads : (Array.isArray(cat.clients) ? cat.clients : []),
            products: Array.isArray(cat.products) ? cat.products : []
        };

        // Migrate UI entity config key clients -> leads
        if (!this.ui.entities) this.ui.entities = {};
        if (!this.ui.entities.leads && this.ui.entities.clients) {
            this.ui.entities.leads = this.ui.entities.clients;
            delete this.ui.entities.clients;
        }
    }

    saveData() {
        localStorage.setItem('crm_company', JSON.stringify(this.company));
        localStorage.setItem('crm_leads', JSON.stringify(this.leads));
        localStorage.setItem('crm_products', JSON.stringify(this.products));
        localStorage.setItem('crm_budgets', JSON.stringify(this.budgets));
        localStorage.setItem('crm_customFields', JSON.stringify(this.customFields));
        localStorage.setItem('crm_categories', JSON.stringify(this.categories));
        localStorage.setItem('crm_ui', JSON.stringify(this.ui));
    }

    // Company methods
    saveCompany(data) {
        this.company = { ...this.company, ...data };
        this.saveData();
    }

    // Lead methods
    addLead(lead) {
        lead.id = Date.now();
        this.leads.push(lead);
        this.saveData();
    }

    updateLead(id, lead) {
        const index = this.leads.findIndex(l => l.id === id);
        if (index !== -1) {
            this.leads[index] = { ...this.leads[index], ...lead };
            this.saveData();
        }
    }

    deleteLead(id) {
        this.leads = this.leads.filter(l => l.id !== id);
        this.saveData();
    }

    // Product methods
    addProduct(product) {
        product.id = Date.now();
        this.products.push(product);
        this.saveData();
    }

    updateProduct(id, product) {
        const index = this.products.findIndex(p => p.id === id);
        if (index !== -1) {
            this.products[index] = { ...this.products[index], ...product };
            this.saveData();
        }
    }

    deleteProduct(id) {
        this.products = this.products.filter(p => p.id !== id);
        this.saveData();
    }

    // Budget methods
    addBudget(budget) {
        budget.id = Date.now();
        this.budgets.push(budget);
        this.saveData();
    }

    updateBudget(id, budget) {
        const index = this.budgets.findIndex(b => b.id === id);
        if (index !== -1) {
            this.budgets[index] = { ...this.budgets[index], ...budget };
            this.saveData();
        }
    }

    deleteBudget(id) {
        this.budgets = this.budgets.filter(b => b.id !== id);
        this.saveData();
    }

    // Custom fields methods
    addCustomField(entity, field) {
        field.id = Date.now();
        this.customFields[entity].push(field);
        this.saveData();
    }

    updateCustomField(entity, id, field) {
        const index = this.customFields[entity].findIndex(f => f.id === id);
        if (index !== -1) {
            this.customFields[entity][index] = { ...this.customFields[entity][index], ...field };
            this.saveData();
        }
    }

    deleteCustomField(entity, id) {
        this.customFields[entity] = this.customFields[entity].filter(f => f.id !== id);
        this.saveData();
    }

    // Categories methods
    addCategory(entity, category) {
        category.id = Date.now();
        this.categories[entity].push(category);
        this.saveData();
    }

    updateCategory(entity, id, category) {
        const index = this.categories[entity].findIndex(c => c.id === id);
        if (index !== -1) {
            this.categories[entity][index] = { ...this.categories[entity][index], ...category };
            this.saveData();
        }
    }

    deleteCategory(entity, id) {
        this.categories[entity] = this.categories[entity].filter(c => c.id !== id);
        this.saveData();
    }
}

const dataManager = new DataManager();
