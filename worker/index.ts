/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleDocumentApi } from "./document-api.mjs";
import { handleClassificationApi } from "./classification-api.mjs";
import { handleBoqExtractionApi } from "./boq-extraction-api.mjs";
import { handleSpecificationExtractionApi, handleSpecificationExtractionQueue } from "./specification-extraction-api.mjs";
import { handleEngineeringKnowledgeApi } from "./engineering-knowledge-api.mjs";
import { handleTechnicalRequirementApi } from "./technical-requirement-api.mjs";
import { handleEngineeringClassificationApi } from "./engineering-classification-api.mjs";
import { handleEngineeringKnowledgeGraphApi } from "./engineering-knowledge-graph-api.mjs";
import { handleEngineeringDiscoveryApi } from "./engineering-discovery-api.mjs";
import { handleDrawingIntakeApi } from "./drawing-intake-api.mjs";
import { handleDrawingSymbolRecognitionApi } from "./drawing-symbol-recognition-api.mjs";
import { handleDrawingStructuralParserApi } from "./drawing-structural-parser-api.mjs";
import { handleDrawingStructuralReviewApi } from "./drawing-structural-review-api.mjs";
import { handleDrawingLegendGeometryApi } from "./drawing-legend-geometry-api.mjs";
import { handleSymbolCellSegmentationApi } from "./symbol-cell-segmentation-api.mjs";
import { handleSymbolSignatureMatchingApi } from "./symbol-signature-matching-api.mjs";
import { handleOccurrenceSpatialClusteringApi } from "./occurrence-spatial-clustering-api.mjs";
import { handleProductPriceLibraryApi } from "./product-price-library-api.mjs";
import { handleIdentityResolutionApi } from "./identity-resolution-api.mjs";
import { handleProductMatchingApi } from "./product-matching-api.mjs";
import { handleConfidenceSafetyApi } from "./confidence-safety-api.mjs";
import { handlePricingApi } from "./pricing-api.mjs";
import { handleReviewWorkflowApi } from "./review-workflow-api.mjs";
import { handleExcelExportApi } from "./excel-export-api.mjs";
import { handleDashboardApi } from "./dashboard-api.mjs";
import { handleProductionReadinessApi } from "./production-readiness-api.mjs";
import { handleAuthContextApi } from "./auth-context-api.mjs";
import { handleOrganizationApi } from "./organization-api.mjs";
import { handleCaseStudyLearningApi } from "./case-study-learning-api.mjs";
import { handleKnowledgeLibraryApi } from "./knowledge-library-api.mjs";
import { handleProductIdentityApi } from "./product-identity-api.mjs";
import { handlePresalesWorkflowApi } from "./presales-workflow-api.mjs";
import { handleProjectPricingLearningApi } from "./project-pricing-learning-api.mjs";
import { handleEstimatorReadinessApi } from "./estimator-readiness-api.mjs";
import { handleEstimatorUnderstandingApi } from "./estimator-understanding-api.mjs";
import { securityHeaders } from "../app/domain/production-readiness.mjs";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  SPECIFICATION_QUEUE?: Queue;
  IDENTITY_AUTH_MODE?: "sites" | "local";
  IDENTITY_LOCAL_DEVELOPMENT?: string;
  LOCAL_DEVELOPMENT_USER_ID?: string;
  LOCAL_DEVELOPMENT_USER_EMAIL?: string;
  LOCAL_DEVELOPMENT_USER_NAME?: string;
  ORGANIZATION_BOOTSTRAP_ENABLED?: string;
  APP_ACCESS_MODE?: "single-user";
  APP_USER_ID?: string;
  APP_USER_EMAIL?: string;
  APP_USER_NAME?: string;
  APP_ORGANIZATION_ID?: string;
  BOQ_AI_PROVIDER?: "cloudflare";
  BOQ_AI_MODEL?: string;
  BOQ_AI_MODEL_VERSION?: string;
  BOQ_AI_REST_ENABLED?: "1";
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_API_TOKEN?: string;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await handleSpecificationExtractionQueue(batch, env);
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const secured = (response: Response) => { const headers = new Headers(response.headers); for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); };

    const healthResponse = await handleProductionReadinessApi(request, env);
    if (healthResponse) return secured(healthResponse);

    const authContextResponse = await handleAuthContextApi(request, env);
    if (authContextResponse) return secured(authContextResponse);

    const organizationApiResponse = await handleOrganizationApi(request, env);
    if (organizationApiResponse) return secured(organizationApiResponse);

    const caseStudyResponse = await handleCaseStudyLearningApi(request, env);
    if (caseStudyResponse) return secured(caseStudyResponse);

    const knowledgeLibraryResponse = await handleKnowledgeLibraryApi(request, env);
    if (knowledgeLibraryResponse) return secured(knowledgeLibraryResponse);

    const productIdentityResponse = await handleProductIdentityApi(request, env);
    if (productIdentityResponse) return secured(productIdentityResponse);

    const presalesWorkflowResponse = await handlePresalesWorkflowApi(request, env);
    if (presalesWorkflowResponse) return secured(presalesWorkflowResponse);

    const pricingLearningResponse = await handleProjectPricingLearningApi(request, env);
    if (pricingLearningResponse) return secured(pricingLearningResponse);

    const estimatorReadinessResponse = await handleEstimatorReadinessApi(request, env);
    if (estimatorReadinessResponse) return secured(estimatorReadinessResponse);

    const estimatorUnderstandingResponse = await handleEstimatorUnderstandingApi(request, env);
    if (estimatorUnderstandingResponse) return secured(estimatorUnderstandingResponse);

    const dashboardApiResponse = await handleDashboardApi(request, env);
    if (dashboardApiResponse) return secured(dashboardApiResponse);

    const excelExportApiResponse = await handleExcelExportApi(request, env);
    if (excelExportApiResponse) return secured(excelExportApiResponse);

    const reviewWorkflowApiResponse = await handleReviewWorkflowApi(request, env);
    if (reviewWorkflowApiResponse) return secured(reviewWorkflowApiResponse);

    const pricingApiResponse = await handlePricingApi(request, env);
    if (pricingApiResponse) return secured(pricingApiResponse);

    const confidenceSafetyApiResponse = await handleConfidenceSafetyApi(request, env);
    if (confidenceSafetyApiResponse) return secured(confidenceSafetyApiResponse);

    const productMatchingApiResponse = await handleProductMatchingApi(request, env, ctx);
    if (productMatchingApiResponse) return secured(productMatchingApiResponse);

    const productPriceLibraryApiResponse = await handleProductPriceLibraryApi(request, env);
    if (productPriceLibraryApiResponse) return secured(productPriceLibraryApiResponse);

    const identityResolutionApiResponse = await handleIdentityResolutionApi(request, env);
    if (identityResolutionApiResponse) return secured(identityResolutionApiResponse);

    const engineeringDiscoveryApiResponse = await handleEngineeringDiscoveryApi(request, env);
    if (engineeringDiscoveryApiResponse) return secured(engineeringDiscoveryApiResponse);
    const drawingIntakeApiResponse = await handleDrawingIntakeApi(request, env);
    if (drawingIntakeApiResponse) return secured(drawingIntakeApiResponse);
    const drawingStructuralParserApiResponse = await handleDrawingStructuralParserApi(request, env);
    if (drawingStructuralParserApiResponse) return secured(drawingStructuralParserApiResponse);
    const drawingStructuralReviewApiResponse = await handleDrawingStructuralReviewApi(request, env);
    if (drawingStructuralReviewApiResponse) return secured(drawingStructuralReviewApiResponse);
    const drawingLegendGeometryApiResponse = await handleDrawingLegendGeometryApi(request, env);
    if (drawingLegendGeometryApiResponse) return secured(drawingLegendGeometryApiResponse);
    const symbolCellSegmentationApiResponse = await handleSymbolCellSegmentationApi(request, env);
    if (symbolCellSegmentationApiResponse) return secured(symbolCellSegmentationApiResponse);
    const symbolSignatureMatchingApiResponse = await handleSymbolSignatureMatchingApi(request, env);
    if (symbolSignatureMatchingApiResponse) return secured(symbolSignatureMatchingApiResponse);
    const occurrenceSpatialClusteringApiResponse = await handleOccurrenceSpatialClusteringApi(request, env);
    if (occurrenceSpatialClusteringApiResponse) return secured(occurrenceSpatialClusteringApiResponse);
    const drawingSymbolRecognitionApiResponse = await handleDrawingSymbolRecognitionApi(request, env);
    if (drawingSymbolRecognitionApiResponse) return secured(drawingSymbolRecognitionApiResponse);
    const engineeringKnowledgeGraphApiResponse = await handleEngineeringKnowledgeGraphApi(request, env);
    if (engineeringKnowledgeGraphApiResponse) return secured(engineeringKnowledgeGraphApiResponse);
    const engineeringClassificationApiResponse = await handleEngineeringClassificationApi(request, env);
    if (engineeringClassificationApiResponse) return secured(engineeringClassificationApiResponse);

    const technicalRequirementApiResponse = await handleTechnicalRequirementApi(request, env, ctx);
    if (technicalRequirementApiResponse) return secured(technicalRequirementApiResponse);
    const engineeringKnowledgeApiResponse = await handleEngineeringKnowledgeApi(request, env);
    if (engineeringKnowledgeApiResponse) return secured(engineeringKnowledgeApiResponse);
    const specificationExtractionApiResponse = await handleSpecificationExtractionApi(request, env, ctx);
    if (specificationExtractionApiResponse) return secured(specificationExtractionApiResponse);
    const boqExtractionApiResponse = await handleBoqExtractionApi(request, env, ctx);
    if (boqExtractionApiResponse) return secured(boqExtractionApiResponse);
    const classificationApiResponse = await handleClassificationApi(request, env, ctx);
    if (classificationApiResponse) return secured(classificationApiResponse);
    const documentApiResponse = await handleDocumentApi(request, env, ctx);
    if (documentApiResponse) return secured(documentApiResponse);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return secured(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths));
    }

    return secured(await handler.fetch(request, env, ctx));
  },
};

export default worker;
