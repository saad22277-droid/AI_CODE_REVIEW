"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrContext = getPrContext;
exports.fetchPrDiff = fetchPrDiff;
const github = __importStar(require("@actions/github"));
const rest_1 = require("@octokit/rest");
function getPrContext(githubToken) {
    const { context } = github;
    const pullNumber = context.payload.pull_request?.number;
    if (!pullNumber) {
        throw new Error("No pull_request found in the GitHub Actions event payload. This action must run on a pull_request (or pull_request_target) event.");
    }
    return {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pullNumber,
        octokit: new rest_1.Octokit({ auth: githubToken }),
    };
}
/** Fetches the raw unified diff for the PR, ready for parseUnifiedDiff(). */
async function fetchPrDiff(ctx) {
    const response = await ctx.octokit.pulls.get({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.pullNumber,
        mediaType: { format: "diff" },
    });
    // @octokit/rest types this as an object when format=diff is requested,
    // but at runtime it's the raw diff string — same pattern GitHub's own
    // examples use.
    return response.data;
}
