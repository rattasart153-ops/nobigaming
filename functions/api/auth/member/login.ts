import { handleMemberLogin } from "../../../_shared/auth-api.mjs";

export const onRequestPost = ({ request, env }) => handleMemberLogin(request, env);
