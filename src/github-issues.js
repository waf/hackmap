import axios from 'axios' // ajax library
import serialization from './github-serialization.js'
import auth from './github-oauth.js'

/*
 * GitHub Issues API. Handles saving and polling of 
 * projects, stored as github issue comments.
 *
 * Expects a configuration of:
 * {
 *    organization: "bkkhack",
 *    repository: "hackmap",
 *    label: "BKKHack Main Thread",
 *    pollIntervalSeconds: 60,
 *    onAuthenticationRequired: () => Promise(token)
 *    onProjectsUpdated: (projects) => ()
 * }
 */
export default class GitHubIssueService {
    constructor(config) {
        this.config = config;
        this.github = this.createGithubApiClient(config.organization, config.repository);

        // if the user has already logged in (e.g. in a previous session), use the
        // authenticated client for all operations. Authenticated calls have a
        // higher rate limit, even for calls that don't require authentication
        if(auth.isLoggedIn()) {
            this.ensureAuthenticatedClient();
        }

        // issue ajax requests to load data from github
        // the model will be updated periodically from the callbacks
        this.github.repo.get('issues', { params: { labels: this.config.label } })
            .then(issueResponse => {
                if(!issueResponse.data.length) {
                    throw "Could not find an open issue labeled: " + this.config.label;
                }
                var issue = issueResponse.data[0];
                config.onHelpText(issue.body);
                this.issueNumber = issue.number;
            })
            .then(() => this.pollIssueForComments())
            .catch(err => this.reportError(err));
    }

    postNewProject(project) {
        return this.ensureAuthenticatedClient()
            .then(() => {
                let body = serialization.serializeProjectToComment(project);
                return this.github.repo
                    .post('issues/' + this.issueNumber + '/comments', { body: body });
            })
            .then((response) => {
                return serialization.deserializeCommentToProject(response.data);
            });
    }

    updateProject(project) {
        return this.ensureAuthenticatedClient()
            .then(() => {
                let body = serialization.serializeProjectToComment(project);
                return this.github.repo.patch('issues/comments/' + project.id, { body: body });
            })
            .then(response => {
                return serialization.deserializeCommentToProject(response.data);
            });
    }

    pollIssueForComments() {
        var commentsUrl = "issues/" + this.issueNumber  + "/comments";

        var poll = () => {
            console.log("polling...");
            return this.github.repo
                .get(commentsUrl)
                .then(response => {
                    var projects = response.data
                        .map(serialization.deserializeCommentToProject);
                    this.config.onProjectsUpdated(projects);
                })
                .catch(err => this.reportError(err));
        }

        window.setInterval(poll, 1000 * this.config.pollIntervalSeconds);
        return poll();
    }

    ensureAuthenticatedClient() {
        return this.config.onAuthenticationRequired()
            .then(token => {
                if(!this.github.isAuthenticated) {
                    this.github = this.createGithubApiClient(
                            this.config.organization,
                            this.config.repository,
                            token);
                    this.github.isAuthenticated = true;
                    return this.github.get("user");
                }
            }).then(response => {
                if(response) {
                    this.config.onUserAuthenticated(response);
                }
            });
    }

    deauthenticateClient() {
        auth.logOut();
        this.github = this.createGithubApiClient(
                this.config.organization,
                this.config.repository);
    }

    createGithubApiClient(org, repo, token) {
        function getApiConfig(apiPath) {
            var config = {
                baseURL: 'https://api.github.com/' + (apiPath || ''),
            }
            if(token) {
                config.headers = { 'Authorization': 'token ' + token };
            }
            return config;
        }
        // general github ajax client
        var github = axios.create(getApiConfig());

        // repo-specific ajax client
        github.repo = axios.create(getApiConfig(`repos/${org}/${repo}/`));

        return github;
    }

    reportError(err) {
        console.log(err);
    }
}