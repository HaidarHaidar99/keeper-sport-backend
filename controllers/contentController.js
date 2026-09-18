const contentService = require("../services/contentService");
const { sendSuccess } = require("../utils/responseUtils");

// Website Settings
const getSettings = async (req, res, next) => {
    try {
        const settings = await contentService.getWebsiteSettings();
        return sendSuccess(res, settings, "Settings fetched");
    } catch (err) {
        next(err);
    }
};

// Hero Slides
const getHeroSlides = async (req, res, next) => {
    try {
        const slides = await contentService.getHeroSlides();
        return sendSuccess(res, slides, "Hero slides fetched");
    } catch (err) {
        next(err);
    }
};

// Offers
const getOffers = async (req, res, next) => {
    try {
        const offers = await contentService.getOffers();
        return sendSuccess(res, offers, "Offers fetched");
    } catch (err) {
        next(err);
    }
};

// Submit Contact Message
const submitContact = async (req, res, next) => {
    try {
        const { name, phone, email, message } = req.body;
        const msg = await contentService.submitContactMessage({ name, phone, email, message });
        return sendSuccess(res, msg, "Contact message received", 201);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getSettings,
    getHeroSlides,
    getOffers,
    submitContact
};
