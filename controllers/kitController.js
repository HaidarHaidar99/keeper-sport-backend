const kitService = require("../services/kitService");
const { sendSuccess } = require("../utils/responseUtils");

// Public Active Kits
const getKits = async (req, res, next) => {
    try {
        const kits = await kitService.getActiveKits();
        return sendSuccess(res, kits, "Kits fetched");
    } catch (err) {
        next(err);
    }
};

// Kit Details with Sizes, Typography Configs & Badges
const getKitById = async (req, res, next) => {
    try {
        const kit = await kitService.getKitById(req.params.id);
        return sendSuccess(res, kit, "Kit details fetched");
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getKits,
    getKitById
};
