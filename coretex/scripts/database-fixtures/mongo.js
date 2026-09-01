const smoke = db.getSiblingDB("coretex_smoke");

smoke.samples.insertMany([
    { id: 1, label: "alpha", tags: ["smoke", "document"] },
    { id: 2, label: "beta", tags: ["smoke"] },
    { id: 3, label: "gamma", tags: [] },
]);

smoke.createUser({
    user: "coretex",
    pwd: "coretex-smoke",
    roles: [{ role: "read", db: "coretex_smoke" }],
});
